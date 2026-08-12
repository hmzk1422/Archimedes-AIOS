import os
import re
import json
import glob
import shutil
import time
import urllib.parse
import requests
import tempfile
from dotenv import load_dotenv

from llama_cloud import LlamaCloud

from langchain_ollama import ChatOllama
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_text_splitters import MarkdownHeaderTextSplitter
from langchain_chroma import Chroma
from langchain_community.chat_message_histories import FileChatMessageHistory
from langchain_core.tools import tool
from langchain_core.messages import ToolMessage
from supabase import create_client, Client
from langchain_community.vectorstores import SupabaseVectorStore

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, create_model, Field
from typing import Any

# RAGAS Evaluation
from ragas import evaluate, EvaluationDataset
from ragas.llms import LangchainLLMWrapper
from ragas.embeddings import LangchainEmbeddingsWrapper
from flashrank import Ranker, RerankRequest
from langchain_core.documents import Document

# ==========================================
# 1. Setup AI Models
# ==========================================
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")

# FIX 1: Fixed dual-model strategy.
# cheap_llm stays on "gemini-3.1-flash-lite" (lightweight) for routing,
# extraction, and lightweight tasks.
# heavy_llm also uses "gemini-3.1-flash-lite" for CoT/Reflection.
cheap_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    google_api_key=api_key,
    temperature=0.1
)

heavy_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    google_api_key=api_key,
    temperature=0.2
)

ranker = Ranker(model_name="ms-marco-MiniLM-L-12-v2")
# Default llm alias for backward compatibility with existing code
llm = cheap_llm

# ==========================================
# 1b. Embeddings Provider Selection
# ==========================================
# EMBEDDINGS_PROVIDER env var controls which embeddings backend to use.
#   "ollama" (default) → free local nomic-embed-text via Ollama (no API cost)
#   "google"           → GoogleGenerativeAIEmbeddings (cloud-native, pay-per-use)
EMBEDDINGS_PROVIDER = os.getenv("EMBEDDINGS_PROVIDER", "ollama").lower()

if EMBEDDINGS_PROVIDER == "google":
    print("[Embeddings] Using GoogleGenerativeAIEmbeddings (cloud-native)")
    from langchain_google_genai import GoogleGenerativeAIEmbeddings
    embeddings = GoogleGenerativeAIEmbeddings(
        model="text-embedding-004",
        google_api_key=api_key,
    )
else:
    print("[Embeddings] Using OllamaEmbeddings with nomic-embed-text (local, free)")
    from langchain_ollama import OllamaEmbeddings
    embeddings = OllamaEmbeddings(
        model="nomic-embed-text",
    )

def extract_text(content):
    """Safely flattens LangChain/Gemini content blocks into a clean string."""
    if isinstance(content, list):
        return "".join([part.get("text", "") if isinstance(part, dict) else str(part) for part in content])
    return str(content)

# ==========================================
# 1c. AI Mode Helpers
# ==========================================
# "mode" is the tenant's active AI mode (e.g. customer_support, sales, billing).
# "datatype" is the KB/task/instruction slice within that mode.

DEFAULT_AI_MODES = [
    {"active": "customer_support", "label": "Customer Support"},
    {"active": "sales", "label": "Sales"},
    {"active": "billing", "label": "Billing"},
# ✅ FIX: Always scope the query to a specific tenant_id (defaulting to \"global\")\n    # so we never accidentally match a row from a different tenant.\n    query_parts.append(f\"tenant_id=eq.{urllib.parse.quote(tenant_id or 'global', safe='')}\")\n    query_url = f\"{rest_url}?{'&'.join(query_parts)}&select=id\"\n     \n    headers = {\n        \"apikey\": os.getenv(\"SUPADB_API\"),\n        \"Authorization\": f\"Bearer {os.getenv('SUPADB_API')}\"\n    }\n
]

_tenant_mode_cache: dict = {}
_MODE_TTL_SECONDS = 120


def get_tenant_active_mode(tenant_id: str | None = None) -> str:
    """Return the active mode slug for a tenant, defaulting to 'customer_support'."""
    if not tenant_id:
        return "customer_support"
    now = time.monotonic()
    cached = _tenant_mode_cache.get(tenant_id)
    if cached and (now - cached[0]) < _MODE_TTL_SECONDS:
        return cached[1] or "customer_support"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{tenant_id}&select=mode&limit=1",
            headers=headers, timeout=10,
        )
        if resp.status_code == 200:
            rows = resp.json() or []
            if rows:
                mode_data = rows[0].get("mode")
                if isinstance(mode_data, dict):
                    active = mode_data.get("active")
                    if active:
                        _tenant_mode_cache[tenant_id] = (now, active)
                        return active
    except Exception:
        pass
    _tenant_mode_cache[tenant_id] = (now, "customer_support")
    return "customer_support"


def fetch_agent_tasks_for_mode(tenant_id: str | None = None, mode: str | None = None) -> list[dict]:
    """Fetch agent tasks for a specific mode."""
    mode = mode or get_tenant_active_mode(tenant_id)
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    if not rest_url:
        return []
    query_url = (
        f"{rest_url}?filename=eq.{urllib.parse.quote(mode, safe='')}"
        f"&datatype=eq.agent_tasks"
    )
    if tenant_id:
        query_url += f"&tenant_id=eq.{tenant_id}"
    query_url += "&select=data&limit=1"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    try:
        response = requests.get(query_url, headers=headers, timeout=10)
        if response.status_code != 200:
            return []
        rows = response.json() or []
        if not rows:
            return []
        raw = rows[0].get("data")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                raw = {}
        if isinstance(raw, dict):
            tasks = raw.get("tasks", [])
            if isinstance(tasks, list):
                return [t for t in tasks if isinstance(t, dict)]
    except Exception:
        pass
    return []


# ==========================================
# 2. Pre-Processing: PDF to Markdown Pipeline (Supabase -> LlamaParse -> MD)
# ==========================================

# Initialize Supabase Client
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://vcqfplrdymwfisbekokp.supabase.co")
SUPABASE_KEY = os.getenv("SUPADB_API") # <-- Updated to match your .env variable
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
supabase.options.schema = "public"

def check_if_md_exists(base_name, datatype_label, tenant_id=None):
    """Queries Supabase to see if the MD content for this file already exists."""
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    # URL-encode filter values so file names with spaces/special chars can't
    # break the PostgREST query (long/weird names were breaking uploads).
    query_parts = [
        f"filename=eq.{urllib.parse.quote(base_name, safe='')}",
        f"datatype=eq.{urllib.parse.quote(datatype_label, safe='')}",
    ]

    # ✅ FIX: Always scope the query to a specific tenant_id (defaulting to "global")
    # so we never accidentally match a row from a different tenant.
    query_parts.append(f"tenant_id=eq.{urllib.parse.quote(tenant_id or 'global', safe='')}")

    query_url = f"{rest_url}?{'&'.join(query_parts)}&select=id"

    headers = {
        "apikey": os.getenv("SUPADB_API"),
        "Authorization": f"Bearer {os.getenv('SUPADB_API')}"
    }
    
    try:
        response = requests.get(query_url, headers=headers)
        if response.status_code == 200:
            return len(response.json()) > 0
    except Exception as e:
        print(f"⚠️ Error checking database for {base_name}: {e}")
    return False

def check_if_embedded(base_name, datatype_label, tenant_id=None):
    """Checks the VECTOR table (documents), not the raw text table."""
    metadata_filter = {"source": base_name, "datatype": datatype_label}
    # ✅ FIX: Always include tenant_id in the filter. Using "global" as the
    # default ensures we never match documents from a different tenant when
    # the caller passes an empty/None tenant_id. Previously, when tenant_id
    # was falsy, the key was omitted entirely and ANY document matching source
    # + datatype would be found — causing cross-tenant false positives.
    metadata_filter["tenant_id"] = tenant_id or "global"
    query_url = f"{SUPABASE_URL}/rest/v1/documents?metadata=cs.{urllib.parse.quote(json.dumps(metadata_filter))}&select=id&limit=1"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    try:
        response = requests.get(query_url, headers=headers)
        if response.status_code == 200:
            return len(response.json()) > 0
    except Exception as e:
        print(f"⚠️ Error checking embeddings for {base_name}: {e}")
    return False

def fetch_existing_md(base_name, datatype_label, tenant_id=None):
    """Pulls previously-parsed MD text back out so it can be re-embedded without re-running LlamaParse."""
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    # URL-encode filter values (same protection as check_if_md_exists).
    query_parts = [
        f"filename=eq.{urllib.parse.quote(base_name, safe='')}",
        f"datatype=eq.{urllib.parse.quote(datatype_label, safe='')}",
    ]
    # ✅ FIX: Always filter by tenant_id so we only fetch the row belonging to
    # the current tenant (or "global" bucket), preventing cross-tenant data leakage.
    query_parts.append(f"tenant_id=eq.{urllib.parse.quote(tenant_id or 'global', safe='')}")
    query_url = f"{rest_url}?{'&'.join(query_parts)}&select=data"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    try:
        response = requests.get(query_url, headers=headers)
        if response.status_code == 200:
            rows = response.json()
            if rows:
                return rows[0].get("data")
    except Exception as e:
        print(f"⚠️ Error fetching existing MD for {base_name}: {e}")
    return None


def delete_knowledge_file(tenant_id, datatype_label, file_name):
    """Delete the knowledge-base DB rows and vector documents for a storage file."""
    base_name = os.path.splitext(file_name)[0]
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    deleted_rows = 0
    deleted_documents = 0

    try:
        query_url = (
            f"{rest_url}?filename=eq.{urllib.parse.quote(base_name, safe='')}"
            f"&datatype=eq.{urllib.parse.quote(datatype_label, safe='')}"
            f"&tenant_id=eq.{urllib.parse.quote(str(tenant_id), safe='')}&select=id"
        )
        response = requests.get(query_url, headers=headers, timeout=10)
        if response.status_code == 200:
            rows = response.json() or []
            for row in rows:
                delete_url = f"{rest_url}?id=eq.{row['id']}"
                delete_response = requests.delete(delete_url, headers=headers, timeout=10)
                if delete_response.status_code in {200, 204}:
                    deleted_rows += 1
    except Exception as exc:
        print(f"⚠️ Failed to delete knowledge rows for {base_name}: {exc}")

    try:
        documents_url = f"{SUPABASE_URL}/rest/v1/documents"
        document_query = (
            f"metadata->>tenant_id=eq.{urllib.parse.quote(str(tenant_id), safe='')}"
            f"&metadata->>datatype=eq.{urllib.parse.quote(datatype_label, safe='')}"
            f"&metadata->>source=eq.{urllib.parse.quote(base_name, safe='')}"
        )  
        response = requests.get(
            f"{documents_url}?{document_query}&select=id",
            headers=headers,
            timeout=10,
        )
        if response.status_code == 200:
            docs = response.json() or []
            for doc in docs:
                delete_response = requests.delete(
                    f"{documents_url}?id=eq.{doc['id']}",
                    headers=headers,
                    timeout=10,
                )
                if delete_response.status_code in {200, 204}:
                    deleted_documents += 1
    except Exception as exc:
        print(f"⚠️ Failed to delete vector documents for {base_name}: {exc}")

    return {
        "deleted_rows": deleted_rows,
        "deleted_documents": deleted_documents,
        "base_name": base_name,
    }

def delete_all_tenant_data(tenant_id):
    """
    Delete EVERY piece of knowledge data belonging to a tenant (workspace):
    raw parsed-markdown rows in customer-service-provider, pgvector documents,
    and the files in Supabase storage under the tenant's folder. Used when an
    account/workspace is deleted so no orphaned data is left behind (and so a
    future tenant with a new id can never bleed into old info).
    """
    if not tenant_id:
        return {"deleted_rows": 0, "deleted_documents": 0, "deleted_files": 0}

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    documents_url = f"{SUPABASE_URL}/rest/v1/documents"
    bucket = os.getenv("SUPABASE_BUCKET", "customer-service-provider")

    deleted_rows = 0
    deleted_documents = 0
    deleted_files = 0

    # 1) Raw parsed-markdown rows in customer-service-provider
    try:
        response = requests.get(
            f"{rest_url}?tenant_id=eq.{tenant_id}&select=id",
            headers=headers, timeout=15,
        )
        for row in (response.json() or []) if response.status_code == 200 else []:
            del_resp = requests.delete(
                f"{rest_url}?id=eq.{row['id']}", headers=headers, timeout=15
            )
            if del_resp.status_code in {200, 204}:
                deleted_rows += 1
    except Exception as exc:
        print(f"⚠️ delete_all_tenant_data rows: {exc}")

    # 2) pgvector documents whose metadata carries this tenant_id
    # ✅ FIX: Also catch documents that have NULL, empty, or missing tenant_id
    # in their metadata — these are orphans left by bugs prior to the
    # tenant_id-metadata fix. They cannot be matched by the exact eq filter
    # above, so we run a second sweep covering NULL and empty-string values.
    try:
        # 2a. Exact tenant_id match (the common case)
        response = requests.get(
            f"{documents_url}?metadata->>tenant_id=eq.{tenant_id}&select=id",
            headers=headers, timeout=15,
        )
        for doc in (response.json() or []) if response.status_code == 200 else []:
            del_resp = requests.delete(
                f"{documents_url}?id=eq.{doc['id']}", headers=headers, timeout=15
            )
            if del_resp.status_code in {200, 204}:
                deleted_documents += 1

        # 2b. Safety-net: delete documents with empty-string or NULL tenant_id
        # that were orphaned by the old "" default or pre-fix insertions.
        for null_filter in ["tenant_id=eq.", "tenant_id=is.null"]:
            try:
                resp = requests.get(
                    f"{documents_url}?metadata->>{null_filter}&select=id",
                    headers=headers, timeout=15,
                )
                if resp.status_code == 200:
                    for doc in resp.json() or []:
                        del_resp = requests.delete(
                            f"{documents_url}?id=eq.{doc['id']}",
                            headers=headers, timeout=15,
                        )
                        if del_resp.status_code in {200, 204}:
                            deleted_documents += 1
            except Exception as exc2:
                print(f"⚠️ cleanup orphaned documents ({null_filter}): {exc2}")
    except Exception as exc:
        print(f"⚠️ delete_all_tenant_data documents: {exc}")

    # 3) Files in Supabase storage under <tenant_id>/...
    try:
        prefix = tenant_id.rstrip("/")
        paths = []
        def walk(path):
            items = supabase.storage.from_(bucket).list(path=path)
            for item in items or []:
                full = f"{path}/{item['name']}" if path else item["name"]
                if item.get("id"):  # a real file (folders have no id)
                    paths.append(full)
                else:  # a folder -> descend
                    walk(full)
        walk(prefix)
        # Supabase remove() accepts at most 100 paths per call
        for i in range(0, len(paths), 100):
            batch = paths[i:i + 100]
            res = supabase.storage.from_(bucket).remove(batch)
            if res is not None and not getattr(res, "get", lambda *a: None)("error"):
                deleted_files += len(batch)
    except Exception as exc:
        print(f"⚠️ delete_all_tenant_data storage: {exc}")

    print(
        f"🧹 Deleted tenant data for {tenant_id}: "
        f"rows={deleted_rows} docs={deleted_documents} files={deleted_files}"
    )
    return {
        "deleted_rows": deleted_rows,
        "deleted_documents": deleted_documents,
        "deleted_files": deleted_files,
    }

def preprocess(tenant_id=None, datatype_label="policies"):
    print(f"\n--- Processing PDFs from Supabase Storage for {datatype_label.upper()} ---")

    # 🌟 FIXED: Defined at the absolute top so nested functions can access it
    SUPABASE_KEY = os.getenv("SUPADB_API") 

    client = LlamaCloud()
    md_header_splits = []

    headers_to_split_on = [("#", "Header 1"), ("##", "Header 2"), ("###", "Header 3")]
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)

    # ✅ FIX: Never leave tenant_scope as an empty string. When no tenant_id is
    # provided we default to "global" so that every document inserted into the
    # pgvector `documents` table has a *non-null, non-empty* tenant_id in its
    # metadata JSON. Previously "" was used, which the Supabase JSONB column
    # showed as NULL — causing orphaned documents that could not be matched
    # by tenant-scoped queries or cleaned up on account deletion.
    tenant_scope = tenant_id or "global"

    try:
        bucket_name = os.getenv("SUPABASE_BUCKET", "customer-service-provider")
        list_path = f"{tenant_scope}/{datatype_label}".strip("/") if tenant_scope or datatype_label else ""
        storage_objects = supabase.storage.from_(bucket_name).list(path=list_path)
    except Exception as exc:
        print(f"❌ Failed to list Supabase Storage bucket: {exc}")
        return []

    for item in storage_objects or []:
        raw_name = (item.get("name") or "").strip()
        if not raw_name or raw_name in {".", ".."}:
            continue
        if raw_name.endswith("/"):
            continue

        if list_path and raw_name.startswith(list_path):
            relative_path = raw_name
        elif '/' in raw_name and not list_path:
            relative_path = raw_name
        else:
            relative_path = f"{list_path}/{raw_name}".strip("/") if list_path else raw_name

        filename_only = os.path.basename(relative_path)
        ext = os.path.splitext(filename_only)[1].lower()
        if ext != ".pdf":
            print(f"⏭️ Skipping non-PDF object: {relative_path}")
            continue

        try:
            base_name = os.path.splitext(filename_only)[0]
            object_path = relative_path

            embeddings_already_exist = check_if_embedded(base_name, datatype_label, tenant_id=tenant_scope)

            if embeddings_already_exist:
                print(f"✅ {base_name} already vectorized in 'documents'. Skipping parse.")
                continue

            try:
                signed_url_response = supabase.storage.from_(bucket_name).create_signed_url(object_path, 3600)
            except Exception as signed_exc:
                print(f"⚠️ Could not create signed URL for {object_path}: {signed_exc}")
                continue

            signed_url = signed_url_response.get("signedURL") if isinstance(signed_url_response, dict) else None

            if not signed_url:
                print(f"⚠️ Could not create signed URL for {object_path}")
                continue

            print(f"Downloading {base_name}.pdf from storage...")
            response = requests.get(signed_url)
            response.raise_for_status()

            print(f"Uploading {base_name}.pdf directly to LlamaCloud...")
            file_obj = client.files.create(
                file=(f"{base_name}.pdf", response.content, "application/pdf"),
                purpose="parse"
            )

            # 👇 ADD THE PARSING INSTRUCTION HERE
            table_prompt = (
                "You are parsing insurance documents. Whenever you encounter a comparison table "
                "with multiple plans (e.g., Standard, Extra, Premier), DO NOT output a standard Markdown grid. "
                "Instead, flatten the table into explicit text sentences for every cell. "
                "Example: 'For the Premier Plan, the Outpatient Benefit limit is $500.' "
                "Ensure the plan name and the benefit name are explicitly stated on every single line."
            )

            result = client.parsing.parse(
                file_id=file_obj.id,
                tier="agentic",
                version="latest",
                agentic_options={"custom_prompt": table_prompt}, # <-- v2 API: nested under agentic_options
                expand=["markdown"]
            )
            
            md_content = "\n\n".join([page.markdown for page in result.markdown.pages])

            print("Saving raw Markdown to Supabase table...")
            rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
            rest_headers = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }

            payload = {
                "data": md_content,
                "datatype": datatype_label,
                "filename": base_name,
                "tenant_id": tenant_scope
            }
            rest_response = requests.post(rest_url, json=payload, headers=rest_headers)

            if rest_response.status_code in [200, 201]:
                print(f"✅ Successfully inserted raw {base_name}.md into Supabase.")
            else:
                print(f"⚠️ Failed to insert raw MD: {rest_response.text}")

            splits = markdown_splitter.split_text(md_content)
            for split in splits:
                split.metadata["source"] = base_name
                split.metadata["datatype"] = datatype_label
                split.metadata["tenant_id"] = tenant_scope
            md_header_splits.extend(splits)

        except Exception as e:
            item_display = locals().get('filename_only') or locals().get('relative_path') or locals().get('raw_name') or 'unknown'
            print(f"❌ Failed to process {item_display}. Error: {e}")

    def process_database_only_entries(tenant_id, tenant_scope, datatype_label):
        """Fetches text directly from DB if it bypassed the storage bucket."""
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
        # ✅ FIX: Select tenant_id as well
        query_url = f"{rest_url}?datatype=eq.{datatype_label}&select=filename,data,tenant_id"
        # ✅ FIX: Use the *original* tenant_id (not the "global" fallback) to filter
        # the raw table. When tenant_id is None we are in global mode and should
        # fetch rows from ALL tenants (each row's own tenant_id is preserved below).
        if tenant_id:
            query_url += f"&tenant_id=eq.{tenant_id}"
                
        headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        response = requests.get(query_url, headers=headers)
        
        if response.status_code == 200:
                rows = response.json()
        for row in rows:
            base_name = row.get("filename")
            text_data = row.get("data")
            # ✅ FIX: Always fall back to "global" (never "") so documents are
            # never stored with an empty/NULL tenant_id in pgvector metadata.
            row_tenant = row.get("tenant_id") or tenant_scope or "global"
                
            if check_if_embedded(base_name, datatype_label, row_tenant):
                continue
                    
                if text_data:
                    print(f"♻️ Chunking and embedding DB-only entry: {base_name} for tenant: {row_tenant}")
                    splits = markdown_splitter.split_text(text_data)
                    for split in splits:
                        split.metadata["source"] = base_name
                        split.metadata["datatype"] = datatype_label
                        split.metadata["tenant_id"] = row_tenant # ✅ Assigned correctly
                    md_header_splits.extend(splits)

    process_database_only_entries(tenant_id, tenant_scope, datatype_label)

    # ==========================================
    # 2. Vector Database Initialization (pgvector)
    # ==========================================
    print(f"\n--- Initializing pgvector in Supabase for {datatype_label.upper()} ---")
    
    # 🌟 FIXED: Removed the redundant SUPABASE_KEY assignment from here

    if md_header_splits:
        vectorstore = SupabaseVectorStore.from_documents(
            md_header_splits,
            embeddings,
            client=supabase,
            table_name="documents",
            query_name="match_documents"
        )
    else:
        vectorstore = SupabaseVectorStore(
            embedding=embeddings,
            client=supabase,
            table_name="documents",
            query_name="match_documents"
        )

        # ✅ FIX: Only apply a tenant_id filter when the caller explicitly provided
    # one. When tenant_id is None (global mode) we search *all* documents
    # regardless of tenant, so no filter is applied. Using `tenant_id` (the
    # original parameter) instead of `tenant_scope` (which now always has a
    # value) preserves this behaviour while still guaranteeing that every
    # stored document has a non-empty tenant_id in its metadata.
    filter_kwargs = {"datatype": datatype_label}
    if tenant_id:
        filter_kwargs["tenant_id"] = tenant_id

    retriever = vectorstore.as_retriever(
        search_kwargs={
            "k": 10,
            "filter": filter_kwargs
        }
    )
    return retriever


# ==========================================
# 4. Long-Term Memory Engine (User Profile)
# ==========================================
# USE_SUPABASE_MEMORY env var controls where user profiles are stored.
#   "false" (default) → local JSON files in api/memory/ (no DB table needed)
#   "true"            → Supabase "user_profiles" table (requires table setup)
_USE_SUPABASE_MEMORY = os.getenv("USE_SUPABASE_MEMORY", "false").lower() == "true"

def _profile_path_for(tenant_id: str | None = None, customer_id: str | None = None) -> str:
    """Returns the local JSON file path for a user profile."""
    memory_dir = os.path.join(os.path.dirname(__file__), "memory")
    os.makedirs(memory_dir, exist_ok=True)
    safe_tenant = re.sub(r'[^a-zA-Z0-9_-]', '', tenant_id or "global")
    safe_customer = re.sub(r'[^a-zA-Z0-9_-]', '', customer_id or "shared")
    return os.path.join(memory_dir, f"profile_{safe_tenant}_{safe_customer}.json")

def _profile_table_name():
    """Returns the Supabase table name for user profiles."""
    return "user_profiles"

def _history_table_name():
    """Returns the Supabase table name for chat histories."""
    return "chat_histories"

def load_user_profile(tenant_id: str | None = None, customer_id: str | None = None):
    """Loads user profile from local JSON (default) or Supabase (opt-in)."""
    if _USE_SUPABASE_MEMORY:
        try:
            query = supabase.table(_profile_table_name())\
                .select("profile_data")\
                .eq("tenant_id", tenant_id or "global")\
                .eq("customer_id", customer_id or "shared")\
                .limit(1)\
                .execute()
            if query.data and len(query.data) > 0:
                raw = query.data[0].get("profile_data")
                if isinstance(raw, str):
                    return json.loads(raw)
                elif isinstance(raw, dict):
                    return raw
        except Exception as e:
            print(f"WARNING: Failed to load user profile from Supabase: {e}")
        return {}
    else:
        # Local JSON file fallback
        path = _profile_path_for(tenant_id, customer_id)
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"WARNING: Failed to load local profile: {e}")
        return {}

def save_user_profile(profile_data, tenant_id: str | None = None, customer_id: str | None = None):
    """Saves user profile to local JSON (default) or Supabase (opt-in)."""
    if _USE_SUPABASE_MEMORY:
        try:
            supabase.table(_profile_table_name()).upsert({
                "tenant_id": tenant_id or "global",
                "customer_id": customer_id or "shared",
                "profile_data": profile_data,
            }, on_conflict="tenant_id,customer_id").execute()
        except Exception as e:
            print(f"WARNING: Failed to save user profile to Supabase: {e}")
    else:
        path = _profile_path_for(tenant_id, customer_id)
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(profile_data, f, indent=2, ensure_ascii=False)
        except IOError as e:
            print(f"WARNING: Failed to save local profile: {e}")

def extract_and_update_facts(user_input, current_profile, tenant_id: str | None = None, customer_id: str | None = None):
    extractor_prompt = f"""You are a data extraction assistant. Look at the user's input and extract any hard personal facts (e.g., age, occupation, medical conditions, budget).
    
    Current User Profile: {json.dumps(current_profile)}
    User's New Message: "{user_input}"
    
    If there are new facts, merge them with the current profile and output ONLY valid JSON. 
    If there are no new facts, output the current profile exactly as it is, in valid JSON.
    Do not output any markdown formatting (like ```json). Just the raw JSON braces."""
    
    try:
        response = cheap_llm.invoke([HumanMessage(content=extractor_prompt)])
        raw_content = extract_text(response.content)
        clean_json_string = raw_content.strip().strip('`').replace('json\n', '', 1)
        updated_profile = json.loads(clean_json_string)
        save_user_profile(updated_profile, tenant_id, customer_id)
        return updated_profile
    except Exception:
        return current_profile

# In-memory session history cache (fast, no I/O)
_session_history_cache: dict = {}

def get_session_history(tenant_id: str | None = None, customer_id: str | None = None):
    """Returns an in-memory chat message history for the given tenant/customer.
    This avoids local file I/O and is safe for multi-threaded environments.
    For production persistence, this should be backed by Redis or Supabase."""
    key = f"{tenant_id or 'global'}_{customer_id or 'shared'}"
    if key not in _session_history_cache:
        from langchain_core.messages import BaseMessage
        class InMemoryChatMessageHistory:
            """Lightweight in-memory chat history that mimics FileChatMessageHistory interface."""
            def __init__(self):
                self.messages: list[BaseMessage] = []
            def add_user_message(self, message: str):
                self.messages.append(HumanMessage(content=message))
            def add_ai_message(self, message: str):
                self.messages.append(AIMessage(content=message))
        _session_history_cache[key] = InMemoryChatMessageHistory()
    return _session_history_cache[key]

from hitl import evaluate_hitl, detect_sentiment, HITLDecision
from hitl_notifier import notify_hitl_triggered

# ==========================================
# 5. Guardrailed System Prompt & Information Routing
# ==========================================

def get_routing_decision(user_input, available_streams):
    """Uses the LLM to categorize the user's intent to route to the correct database."""
    
    # If no streams exist, default to policies safely
    if not available_streams:
        return "policies"
        
    # 🌟 FIX: If there's only 1 stream (e.g., Amazon only has 'research'), skip the LLM and return it!
    if len(available_streams) == 1:
        return available_streams[0]
        
    streams_str = ", ".join([f'"{s}"' for s in available_streams])
    
    router_prompt = f"""You are an intelligent routing assistant.
    Analyze the user's input and categorize it into exactly ONE of these available streams:
    {streams_str}
    
    User Input: "{user_input}"
    
    Respond with ONLY the exact word of the selected stream. No other text, no markdown."""
    
    try:
        response = cheap_llm.invoke([HumanMessage(content=router_prompt)])
        decision = extract_text(response.content).strip().lower()
        
        # Clean up the output to prevent routing errors
        decision = re.sub(r'[^a-z0-9_-]', '', decision)
        
        if decision in available_streams:
            return decision
    except Exception:
        pass
        
    # Safe fallback to the first available datatype
    return available_streams[0]

# ==========================================
# 5b. QUERY REWRITING (The "Brain" Layer)
# ==========================================

def rewrite_search_query(user_input: str, datatype: str = "policies") -> str:
    """
    FIX 4: Rewrites a conversational user query into a precise search query
    that matches the terminology used in the knowledge base documents.
    
    The domain context is parameterized via the `datatype` parameter so this
    works for any tenant (insurance, e-commerce, legal, IT, etc.) without
    hardcoded insurance-specific instructions.
    
    Uses the cheap_llm to transform vague/natural language into 
    document-aligned search terms.
    """
    rewrite_prompt = f"""You are a search query optimization specialist for a knowledge base.

    Rewrite the user's conversational question into a precise search query that will match 
    the exact terminology used in the domain's documents (datatype: "{datatype}").

    Rules:
    - Use formal domain-specific terminology relevant to "{datatype}" documents
    - Include specific terms you expect to find in the actual documents
    - Remove conversational filler words
    - If the query mentions a location or entity, translate it to the formal term used in the documents
    - Keep it as a natural sentence, not just keywords
    - Do NOT answer the question - just rewrite it as a search query

    Original query: "{user_input}"
    Document datatype: {datatype}

    Rewritten query:"""
    
    try:
        response = cheap_llm.invoke([HumanMessage(content=rewrite_prompt)])
        rewritten = extract_text(response.content).strip()
        print(f"\n[Query Rewriter] Original: '{user_input}'")
        print(f"[Query Rewriter] Rewritten: '{rewritten}'")
        # Don't return an empty string - fall back to original
        if rewritten and len(rewritten) > 5:
            return rewritten
    except Exception as e:
        print(f"[Query Rewriter] Error: {e}, falling back to original query")
    
    return user_input


# ==========================================
# 5c. HARD-CODED ROUTING (The "Stop" Button)
# ==========================================

def classify_query_intent(user_input: str) -> str:
    """
    Classifies whether the user query requires specific policy benefit details
    or a general product overview.
    
    Returns: "specific" if the user needs detailed policy benefits/limits/exclusions
             "general" if the user wants a product overview, marketing info, or general explanation
    """
    router_prompt = f"""You are a query classifier for an insurance knowledge base.

    Determine if the user's query requires:
    - "specific": The user is asking about concrete policy details like coverage limits, 
      exclusions, deductibles, benefit amounts, terms, conditions, geographic limits, 
      waiting periods, or any hard policy numbers/rules.
    - "general": The user is asking for a general product overview, brochure information,
      how something works conceptually, marketing materials, or a high-level summary.

    Examples:
    "What is my coverage limit for Asia?" -> specific
    "Does this policy cover emergency evacuation?" -> specific
    "Tell me about the Allianz policy" -> general
    "What benefits are included?" -> specific
    "How does travel insurance work?" -> general
    "Is Bali covered under my plan?" -> specific
    "What's the deductible for outpatient care?" -> specific
    "Can you explain the policy to me?" -> general

    User Query: "{user_input}"
    
    Respond with ONLY the word "specific" or "general". No other text."""
    
    try:
        response = cheap_llm.invoke([HumanMessage(content=router_prompt)])
        decision = extract_text(response.content).strip().lower()
        # Clean up
        decision = re.sub(r'[^a-z]', '', decision)
        if decision in ("specific", "general"):
            print(f"\n[Intent Router] Query: '{user_input[:50]}...' -> {decision.upper()}")
            return decision
    except Exception as e:
        print(f"[Intent Router] Error: {e}, defaulting to 'specific'")
    
    # When in doubt, default to specific (more conservative - gets detailed docs)
    return "specific"


# ==========================================
# 5d. CONSOLIDATED ROUTING (1 LLM CALL)
# ==========================================
# Replaces the three separate cheap_llm calls that used to run for EVERY user
# message (get_routing_decision + rewrite_search_query + classify_query_intent).
# A single call returns stream routing, search-query rewriting, AND specific/
# general intent together, saving ~2 sequential LLM round-trips (~4-8s).

def route_and_plan(user_input, available_streams):
    """One cheap_llm call that plans routing for a user message.

    Returns a dict with:
      - stream: chosen knowledge stream ("" when no streams exist)
      - intent: "specific" or "general"
      - rewritten_query: search-ready query string (falls back to user_input)
    """
    stream = ""
    intent = "specific"
    rewritten_query = ""

    if not available_streams:
        return {"stream": stream, "intent": "general", "rewritten_query": user_input}

    stream_default = available_streams[0]
    only_one = len(available_streams) == 1
    streams_str = ", ".join(f'"{s}"' for s in available_streams)

    router_prompt = f"""You are an intelligent routing assistant for a knowledge base whose available streams are: {streams_str}.

Read the user query and respond with ONLY a JSON object containing exactly these three fields:
1. "stream" — exactly ONE of the available streams ({streams_str}) that best matches the query.
2. "intent" — "specific" if the user asks about concrete policy details (coverage limits, exclusions, deductibles, benefit amounts, terms, conditions, waiting periods, or any hard numbers/rules); otherwise "general" for a product overview, brochure info, or high-level explanation.
3. "rewritten_query" — a precise search query using the exact terminology expected in that stream's documents. Do NOT answer the question, just rewrite it into search terms.

Rules:
- Respond ONLY with the JSON object. No markdown, no code fences, no extra text.
- If only one stream exists ({streams_str}), "stream" must be exactly that stream.
- Use exactly the string values given in the available streams.

User query: "{user_input}"
"""

    try:
        response = cheap_llm.invoke([HumanMessage(content=router_prompt)])
        raw = extract_text(response.content)
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            data = json.loads(match.group(0))
            stream_raw = re.sub(r'[^a-z0-9_-]', '', str(data.get("stream", "")).strip().lower())
            intent_raw = re.sub(r'[^a-z]', '', str(data.get("intent", "")).strip().lower())
            intent = intent_raw if intent_raw in ("specific", "general") else "specific"
            rq = str(data.get("rewritten_query", "")).strip()
            if rq and len(rq) > 5:
                rewritten_query = rq
            if stream_raw:
                stream = stream_raw
    except Exception as e:
        print(f"[route_and_plan] Error: {e}; using defaults")

    if only_one:
        stream = available_streams[0]
    elif stream not in available_streams:
        stream = stream_default
    if not rewritten_query:
        rewritten_query = user_input

    print(f"\n[route_and_plan] stream={stream.upper()} intent={intent.upper()} rewritten={rewritten_query!r}")
    return {"stream": stream, "intent": intent, "rewritten_query": rewritten_query}


# ==========================================
# 5e. HYBRID SEARCH (Vector + Keyword/BM25)
# ==========================================

def _supabase_keyword_search(query: str, datatype: str, tenant_id: str | None = None, k: int = 5) -> list:
    """
    Performs keyword/ILIKE search on the documents table via Supabase REST API.
    This acts as the BM25-equivalent for hybrid search.
    
    Returns a list of dicts with 'id', 'content', 'metadata' keys.
    """
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    
    # Extract meaningful keywords from the query (remove common stop words)
    stop_words = {"the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
                  "have", "has", "had", "do", "does", "did", "will", "would", "can",
                  "could", "shall", "should", "may", "might", "to", "of", "in", "for",
                  "on", "with", "at", "by", "from", "as", "into", "about", "like",
                  "through", "after", "over", "between", "under", "my", "your", "our",
                  "what", "how", "tell", "does", "covered", "cover", "please", "need"}
    
    # Get individual words, filter stop words and short words
    words = re.findall(r'\b[a-zA-Z]{3,}\b', query.lower())
    keywords = [w for w in words if w not in stop_words]
    
    # Take the most important keywords (max 5)
    keywords = keywords[:5]
    
    if not keywords:
        return []
    
    # Build OR conditions for keywords (match ANY keyword = higher recall)
    # Supabase REST syntax: or=(content.ilike.*asia*,content.ilike.*coverage*)
    # The parentheses around the conditions are REQUIRED for correct parsing
    keyword_conditions = f"({','.join([f'content.ilike.*{kw}*' for kw in keywords])})"
    
    # Build the query_url with keyword OR conditions and metadata filters
    # In Supabase/postgREST: "or=..." handles the OR logic; separate URL params = AND logic
    query_params = f"select=id,content,metadata&or={urllib.parse.quote(keyword_conditions)}&limit={k}"
    
        # Add metadata filter as separate URL parameter (AND with the OR conditions)
    query_params += f"&metadata->>datatype.eq.{datatype}"
    # ✅ FIX: Always filter by tenant_id so NULL/empty-tenant documents are never
    # returned. In global mode we explicitly search for the "global" bucket.
    query_params += f"&metadata->>tenant_id.eq.{tenant_id or 'global'}"
    
    query_url = f"{SUPABASE_URL}/rest/v1/documents?{query_params}"
    
    try:
        response = requests.get(query_url, headers=headers, timeout=10)
        if response.status_code == 200:
            return response.json()
        else:
            print(f"[Keyword Search] Error {response.status_code}: {response.text[:300]}")
    except Exception as e:
        print(f"[Keyword Search] Exception: {e}")
    
    return []


def _rrf_merge(vector_results: list, keyword_results: list, k: int = 60, top_n: int = 10) -> list:
    """
    Reciprocal Rank Fusion (RRF) - merges two ranked result lists by their rank positions.
    Score = 1 / (k + rank_in_list)
    
    Higher 'k' means less aggressive fusion. Default k=60 is standard.
    """
    scores = {}
    seen_content = set()
    
    # Score vector results by their position
    for rank, doc in enumerate(vector_results):
        content = doc.page_content
        # Use content hash as key for dedup
        content_key = hash(content[:200])
        if content_key not in seen_content:
            seen_content.add(content_key)
            scores[content_key] = {
                "score": 1.0 / (k + rank + 1),
                "content": content,
                "metadata": doc.metadata,
                "source": "vector"
            }
    
    # Score keyword results by their position
    for rank, doc in enumerate(keyword_results):
        content = doc.get("content", "") if isinstance(doc, dict) else doc.page_content
        content_key = hash(content[:200])
        metadata = doc.get("metadata", {}) if isinstance(doc, dict) else doc.metadata
        
        if content_key in scores:
            # Already seen by vector search - add keyword score
            scores[content_key]["score"] += 1.0 / (k + rank + 1)
            scores[content_key]["source"] = "hybrid"
        else:
            scores[content_key] = {
                "score": 1.0 / (k + rank + 1),
                "content": content,
                "metadata": metadata,
                "source": "keyword"
            }
    
    # Sort by score (descending) and return top_n
    ranked = sorted(scores.values(), key=lambda x: x["score"], reverse=True)
    
    # Convert back to Document-like objects (simulating LangChain Document)
    from langchain_core.documents import Document
    merged = []
    for item in ranked[:top_n]:
        doc = Document(
            page_content=item["content"],
            metadata=item["metadata"]
        )
        merged.append(doc)
    
    return merged

def rerank_documents(query: str, docs: list, top_n: int = 5) -> list:
    """Reranks retrieved documents using a Cross-Encoder model."""
    if not docs:
        return []
    
    passages = [
        {"id": idx, "text": doc.page_content, "meta": doc.metadata}
        for idx, doc in enumerate(docs)
    ]
    
    rerank_request = RerankRequest(query=query, passages=passages)
    results = ranker.rerank(rerank_request)
    
    reranked_docs = []
    for item in results[:top_n]:
        reranked_docs.append(
            Document(page_content=item["text"], metadata=item["meta"])
        )
    return reranked_docs

def hybrid_retrieve(active_retriever, query: str, datatype: str, tenant_id: str | None = None, k: int = 10) -> list:
    """
    Hybrid search pipeline:
    1. Vector search via retriever
    2. Keyword search via Supabase ILIKE
    3. Merge results with RRF
    4. Neural Cross-Encoder Reranking
    """
    # Step 1: Vector search
    print(f"\n[Hybrid Search] Running vector search for: '{query[:60]}...'")
    vector_docs = active_retriever.invoke(query)
    
    # Step 2: Keyword search
    print(f"[Hybrid Search] Running keyword search for: '{query[:60]}...'")
    keyword_results = _supabase_keyword_search(query, datatype, tenant_id, k=k)
    
    # Step 3: Merge with RRF
    merged_docs = _rrf_merge(vector_docs, keyword_results, top_n=k)
    
    # Step 4: 🌟 NEURAL RERANKING
    print(f"[Hybrid Search] Reranking {len(merged_docs)} documents with Cross-Encoder...")
    final_docs = rerank_documents(query, merged_docs, top_n=5)
    
    return final_docs

DEFAULT_SYSTEM_MESSAGE_TEMPLATE = """
KNOWN USER FACTS (LONG-TERM MEMORY):
{profile_text}
"""


def _parse_json_object(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


_tenant_template_cache: dict = {}  # {tenant_id: (timestamp, template)}
_TEMPLATE_TTL_SECONDS = 120


def fetch_mode_custom_instruction(tenant_id: str | None = None, mode: str | None = None) -> str | None:
    """Fetch the per-AI-mode Custom Instruction.

    Custom Instructions are split by AI mode (the same dimension the knowledge
    base uses). They are stored in the `customer-service-provider` table as rows
    with `datatype='custom_instructions'` and `filename=<mode>`.

    Returns:
      - None -> no mode / no row (caller should fall back to the profile column)
      - ''   -> an explicit empty instruction for this mode
      - str  -> the mode's instruction text
    """
    if not mode:
        return None

    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    if not rest_url:
        return None

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    query_url = (
        f"{rest_url}?datatype=eq.custom_instructions"
        f"&filename=eq.{urllib.parse.quote(mode, safe='')}"
    )
    if tenant_id:
        query_url += f"&tenant_id=eq.{tenant_id}"
    query_url += "&select=data&limit=1"

    try:
        response = requests.get(query_url, headers=headers, timeout=10)
        if response.status_code != 200:
            print(f"WARNING: Failed to load AI-mode instruction: {response.status_code} {response.text}")
            return None
        rows = response.json()
        if not rows:
            return None
        raw = rows[0].get("data")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                raw = {}
        if isinstance(raw, dict):
            return raw.get("instruction", "") or ""
    except Exception as exc:
        print(f"WARNING: Failed to load AI-mode custom instruction: {exc}")
    return None


def get_tenant_system_message_template(tenant_id: str | None = None, datatype: str | None = None):
    if not tenant_id:
        return DEFAULT_SYSTEM_MESSAGE_TEMPLATE

    # TTL cache keyed by (tenant, mode) so consecutive messages reuse the build.
    now = time.monotonic()
    cache_key = f"{tenant_id}::{datatype or '_default'}"
    cached = _tenant_template_cache.get(cache_key)
    if cached and (now - cached[0]) < _TEMPLATE_TTL_SECONDS:
        return cached[1]

    # 1) Prefer the per-AI-mode Custom Instruction (split by mode).
    mode_instruction = fetch_mode_custom_instruction(tenant_id, datatype)
    if mode_instruction is not None and str(mode_instruction).strip():
        combined_template = f"""{DEFAULT_SYSTEM_MESSAGE_TEMPLATE}

AI MODE CUSTOM INSTRUCTIONS:
{str(mode_instruction).strip()}
"""
        _tenant_template_cache[cache_key] = (now, combined_template)
        return combined_template

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    query_url = f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{tenant_id}&select=custom_instruction&limit=1"

    try:
        response = requests.get(query_url, headers=headers, timeout=10)
        if response.status_code != 200:
            print(f"WARNING: Failed to load tenant system message: {response.status_code} {response.text}")
            return DEFAULT_SYSTEM_MESSAGE_TEMPLATE

        rows = response.json()
        if not rows:
            return DEFAULT_SYSTEM_MESSAGE_TEMPLATE

        custom_instruction = rows[0].get("custom_instruction")

        # Merge the custom instruction with the default template
        if isinstance(custom_instruction, str) and custom_instruction.strip():
            combined_template = f"""{DEFAULT_SYSTEM_MESSAGE_TEMPLATE}

TENANT CUSTOM INSTRUCTIONS:
{custom_instruction.strip()}
"""
            _tenant_template_cache[cache_key] = (now, combined_template)
            return combined_template

    except Exception as exc:
        print(f"WARNING: Failed to load tenant system message: {exc}")

    _tenant_template_cache[cache_key] = (now, DEFAULT_SYSTEM_MESSAGE_TEMPLATE)
    return DEFAULT_SYSTEM_MESSAGE_TEMPLATE


def get_dynamic_system_prompt(tenant_id: str | None = None, customer_id: str | None = None, datatype: str | None = None):
    profile = load_user_profile(tenant_id, customer_id)
    profile_text = json.dumps(profile, indent=2) if profile else "No user data collected yet."
    template = get_tenant_system_message_template(tenant_id, datatype=datatype)
    return SystemMessage(content=template.replace("{profile_text}", profile_text))

# FIX 5: Helper to strip XML tags from LLM output when XML parsing fails.
# Prevents raw <thinking>/<reflection> blocks from leaking to end users.
def _strip_xml_tags(text: str) -> str:
    """Removes all XML/HTML tags from text, keeping only the content between them."""
    # Remove <tag> and </tag> pairs, keeping inner content
    cleaned = re.sub(r'<[^>]+>', '', text)
    # Collapse multiple newlines into at most 2
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()


def _clean_final_output(raw_text: str) -> str:
    """Extract a clean, user-facing answer from the LLM output.

    The final LLM no longer *prompts* for it, but models sometimes still emit
    internal reasoning blocks like <thinking>/<reflection>. This removes the
    ENTIRE block (tags and content) so users never see "user is asking about..."
    or any other chain-of-thought text, and keeps only the actual answer.
    """
    if not raw_text:
        return ""
    # 1) If the model faithfully wrapped its answer, keep only that block.
    match = re.search(r"<final_answer>(.*?)</final_answer>", raw_text, re.DOTALL)
    if match:
        return match.group(1).strip()
    # 2) Remove the FULL internal reasoning blocks (tags AND their content).
    cleaned = re.sub(
        r"<thinking>.*?</thinking>", "", raw_text, flags=re.DOTALL | re.IGNORECASE
    )
    cleaned = re.sub(
        r"<reflection>.*?</reflection>", "", cleaned, flags=re.DOTALL | re.IGNORECASE
    )
    # 3) Strip any leftover XML/HTML tags (malformed/closing tags, etc.).
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    # 4) Collapse runs of blank lines left behind.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

# ==========================================
# 6. The Ask Agent Function
# ==========================================

session_state = {
    "pending_tool_call": None,  # Stores the tool data when waiting for confirmation
}
def ask_agent(user_input, retrievers, tenant_id=None, customer_id=None, mode=None, system_prompt=None):
    global session_state
    
    # When a node/flow specifies an AI mode (e.g. "statarb"), scope the tasks and
    # custom instructions to it. Otherwise fall back to the tenant's active mode.
    effective_mode = mode or get_tenant_active_mode(tenant_id)
    
    # Use per-tenant + per-customer session state
    tenant_key = f"{tenant_id or 'global'}_{customer_id or 'shared'}"
    if isinstance(session_state, dict):
        # already migrated
        pass
    else:
        # backward compatibility
        session_state = {}
    if tenant_key not in session_state:
        session_state[tenant_key] = {"pending_tool_call": None}
    tenant_state = session_state[tenant_key]
    # ==========================================
    # 1. GATE CHECK (Pending Tool Confirmation)
    # ==========================================
    if tenant_state["pending_tool_call"] is not None:
        if user_input.lower() in ["yes", "y", "confirm", "proceed", "sure"]:
            # User gave explicit permission! Run the saved tool.
            tool_call = tenant_state["pending_tool_call"]
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]
            
            print(f"\n[🔒 USER CONFIRMED: Executing {tool_name} with arguments {tool_args}...]")
            
            # Map and execute the function across per-tenant dynamic toolkits
            toolkits_local, llm_with_tools_local = build_toolkits_for_tenant(tenant_id, mode=effective_mode)
            all_available_tools = [tool for tools in toolkits_local.values() for tool in tools]
            tool_map = {tool.name: tool for tool in all_available_tools}
            
            if tool_name in tool_map:
                try:
                    tool_output = tool_map[tool_name].invoke(tool_args)
                except Exception as exc:
                    tool_output = f"The task '{tool_name}' needs more details before it can run: {exc}"
            else:
                tool_output = f"Error: Tool '{tool_name}' not found."

            # Print explicit terminal feedback so you know it worked
            print(f"[✅ DATABASE UPDATED]: {tool_output}")
            
            # Clear the gate state
            tenant_state["pending_tool_call"] = None
            
            # Let the AI know it was executed successfully
            final_prompt = f"The user confirmed the action. The system successfully executed the tool. Output: {tool_output}. Inform the user."
            messages = [get_dynamic_system_prompt(tenant_id, customer_id, datatype=effective_mode), HumanMessage(content=final_prompt)]
            response_obj = heavy_llm.invoke(messages)
            return {
                "response": _clean_final_output(extract_text(response_obj.content)),
                "hitl_pending": False,
                "tool_executed": tool_name,
                "tool_output": tool_output,
            }
            
        else:
            # User said anything other than yes/confirm -> Abort!
            print("\n[❌ USER ABORTED: Action cancelled.]")
            tenant_state["pending_tool_call"] = None
            return {
                "response": "Action cancelled. I won't perform any changes to your policy.",
                "hitl_pending": False,
                "tool_executed": None,
                "tool_output": "User aborted the action.",
            }

    # ==========================================
    # 2. STANDARD CHAT / INTENT DETECTION FLOW
    # ==========================================
    
    # 🌟 NEW: Route the query dynamically based on actual folders!
    # FIX: One consolidated cheap_llm call replaces the old 3-call routing chain
    # (get_routing_decision + rewrite_search_query + classify_query_intent).
    available_streams = list(retrievers.keys())
    plan = route_and_plan(user_input, available_streams)
    chosen_stream = plan["stream"]
    print(f"\n[AI Router selected knowledge base: {chosen_stream.upper()}]")
    
    active_retriever = retrievers.get(chosen_stream)
    if not active_retriever:
        return {
            "response": f"Error: No knowledge base found for {chosen_stream}. Please upload documents first.",
            "hitl_pending": False,
            "tool_executed": None,
            "tool_output": None,
        }
        
    # Build or fetch tenant-scoped toolkits and bound LLMs for this tenant
    toolkits_local, llm_with_tools_local = build_toolkits_for_tenant(tenant_id, mode=effective_mode)
    # Try to get the LLM bound to the specific datatype's tools first.
    # If no tools match that datatype, fall back to the combined '_all' tools.
    # If no tools exist at all, use the plain heavy_llm.
    active_llm = llm_with_tools_local.get(chosen_stream) or llm_with_tools_local.get("_all", heavy_llm)

    # ==========================================
    # QUERY REWRITE + INTENT (from route_and_plan, 1 LLM call)
    # ==========================================
    query_intent = plan["intent"]
    rewritten_query = plan["rewritten_query"]

    if query_intent == "specific":
        print(f"\n[Hard-Coded Router] Query classified as SPECIFIC - excluding general/overview documents")
    else:
        print(f"\n[Hard-Coded Router] Query classified as GENERAL - searching all documents")

    if tenant_id:
        # ==========================================
        # IMPROVEMENT 2: HYBRID SEARCH (instead of pure vector)
        # ==========================================
        all_chunks = hybrid_retrieve(
            active_retriever, 
            rewritten_query, 
            chosen_stream, 
            tenant_id, 
            k=10
        )

        def chunk_tenant(chunk):
            # Try dict-style access
            md = getattr(chunk, 'metadata', None) or {}
            if isinstance(md, dict):
                for key in ('tenant_id', 'tenant', 'tenantId'):
                    if key in md and md[key]:
                        return str(md[key])
            # Try attribute-style
            for attr in ('tenant_id', 'tenant', 'tenantId'):
                val = getattr(md, attr, None) or getattr(chunk, attr, None)
                if val:
                    return str(val)
            # Fallback: try to parse tenant from source or page_content if it contains a path like '<tenant>/'
            src = None
            if hasattr(chunk, 'source') and chunk.source:
                src = str(chunk.source)
            elif isinstance(md, dict) and md.get('source'):
                src = str(md.get('source'))
            if src and '/' in src:
                return src.split('/')[0]
            return None

        # Build list and log tenant ids for debugging
        # 🔒 STRICT tenant isolation: only keep chunks whose metadata tenant_id
        # exactly matches the current tenant. Chunks with missing/empty/global
        # tenant ids are NOT used (they'd otherwise bleed into every tenant).
        filtered = []
        seen_tenants = set()
        for c in (all_chunks or []):
            t = chunk_tenant(c)
            seen_tenants.add(t)
            if t == tenant_id:
                filtered.append(c)

        print(f"[DEBUG] Retrieved tenants from retriever: {seen_tenants}; kept {len(filtered)} chunks for tenant: {tenant_id}")
        
        # ==========================================
        # Apply hard-coded routing filter
        # ==========================================
        if query_intent == "specific":
            # Filter OUT documents whose source contains keywords like 
            # "overview", "general", "riplay", "brochure", "marketing"
            # Keep only documents that look like benefit tables / policy schedules
            overview_keywords = ['overview', 'general', 'riplay', 'brochure', 'marketing', 'summary']
            before_count = len(filtered)
            filtered = [
                c for c in filtered 
                if not any(kw in (c.metadata.get('source', '') if hasattr(c, 'metadata') else '').lower() 
                          for kw in overview_keywords)
            ]
            after_count = len(filtered)
            print(f"[Hard-Coded Router] Filtered {before_count - after_count} general/overview documents from results")
        
        relevant_chunks = filtered
    else:
        # No tenant - use hybrid search without tenant filter
        all_chunks = hybrid_retrieve(
            active_retriever, 
            rewritten_query, 
            chosen_stream, 
            None, 
            k=10
        )
        # Apply routing filter if needed
        if query_intent == "specific":
            overview_keywords = ['overview', 'general', 'riplay', 'brochure', 'marketing', 'summary']
            before_count = len(all_chunks)
            all_chunks = [
                c for c in all_chunks 
                if not any(kw in (c.metadata.get('source', '') if hasattr(c, 'metadata') else '').lower() 
                          for kw in overview_keywords)
            ]
            print(f"[Hard-Coded Router] Filtered {before_count - len(all_chunks)} general/overview documents from results")
        relevant_chunks = all_chunks
        
    context_for_ai = "\n\n".join([doc.page_content for doc in relevant_chunks])
    
    # ==========================================
    # 2b. CONTEXT PREPARATION
    # ==========================================
    # FIX: Removed the separate cheap_llm context-extraction call. The retrieved
    # chunks are now passed straight to the final LLM, saving one full LLM
    # round-trip per message while keeping tables and raw figures intact.
    # A generous cap keeps the prompt bounded without dropping relevant content.
    print("\n[Gemini] Preparing retrieved context for the final LLM...")
    extracted_facts = context_for_ai[:15000]

    # ==========================================
    # 2c. FINAL ANSWER GENERATION
    # ==========================================
    # FIX: Removed the forced Chain-of-Thought XML (<thinking>/<reflection>/
    # <final_answer>) prompt. It produced long preambles before any answer text
    # (slower) and its reasoning blocks leaked into the chat UI. The model now
    # writes the answer directly; any stray reasoning blocks are still stripped
    # defensively by _clean_final_output().
    print("\n[heavy_llm] Generating final response...")
    final_system_prompt = """
    You are an elite research AI. Your task is to answer the user's query using ONLY the provided facts.

    Rules:
    1. Answer directly and completely. Do NOT output any internal reasoning, chain-of-thought, <thinking>, <reflection>, or any other XML/markup tags.
    2. If the provided facts contain a comparison table, preserve the table format exactly.
    3. Do not invent facts not present in the provided facts. If the facts don't contain an answer, say so clearly.
    """
    
    cot_user_prompt = f"""
    User Query: {user_input}
    
    Provided Facts:
    {extracted_facts}
    """
    
    # Give the model a concrete list of the tenant's tasks so it knows exactly
    # which tools exist and what arguments each one needs.
    task_summary_lines = []
    for _tools in toolkits_local.values():
        for tool in _tools:
            try:
                arg_names = ", ".join((tool.args or {}).keys()) or "none"
            except Exception:
                arg_names = "see tool schema"
            task_summary_lines.append(f"- {tool.name}: {tool.description} (required args: {arg_names})")
    task_summary = "\n".join(task_summary_lines) or "No tasks are registered yet."

    # Instruct the AI when to call a tool vs. ask a clarifying question.
    turn_payload = f"""

    AVAILABLE TASKS YOU CAN EXECUTE:
    {task_summary}

    CRITICAL RULES FOR TASK ACTIONS:
    1. EXECUTE ONLY ON CLEAR INTENT. Call a task tool ONLY when the user clearly wants you to DO that task now (imperative/goal language: "initiate statarb", "please start X", "run X", "sign me up"). A mere mention of a task name — asking what it does, whether it's available, whether it's a good fit, how it works, or discussing its parameters — is NOT a request to execute. Answer those conversationally instead.
    2. DON'T GUESS TASKS. Never call a tool just because a keyword or similar-sounding topic appears, or because the task was part of past conversation. If you are unsure whether the user wants execution, do NOT call the tool.
    3. When you DO determine the user wants execution, fill each required argument in this order: (a) from the user's current message, (b) from the conversation history, (c) from the KNOWN USER FACTS / profile above. Then call the tool right away — do not stall with a wall of questions.
    4. ONLY ask the user for an argument if it is truly required and still unknown after steps above. Ask for ALL missing arguments in ONE short message — never interrogate one at a time, and never repeat something the user already told you.
    5. Because of the security gate, only output the actual tool call when you are ready to execute (never while merely planning or explaining).
    """
    
    # Retrieve per-tenant session history
    session_history = get_session_history(tenant_id, customer_id)
    # Trim history so the prompt doesn't grow unboundedly over a long chat.
    history_messages = session_history.messages[-8:]
    # Apply the AI Agent node's per-node system_prompt (if any) on top of the
    # mode-scoped custom instructions + default template.
    system_msg = get_dynamic_system_prompt(tenant_id, customer_id, datatype=effective_mode)
    if system_prompt and str(system_prompt).strip():
        system_msg = SystemMessage(
            content=system_msg.content
            + "\n\nADDITIONAL SYSTEM INSTRUCTIONS (from AI Agent node):\n"
            + str(system_prompt).strip()
        )
    messages = [system_msg] + history_messages + [
        SystemMessage(content=final_system_prompt),
        HumanMessage(content=cot_user_prompt + turn_payload)
    ]
    
    # Ask the model what it wants to do
    response_obj = active_llm.invoke(messages)

    # ==========================================
    # 3. HITL INTERCEPTION (Human-In-The-Loop)
    # ==========================================
    if response_obj.tool_calls:
        first_tool_call = response_obj.tool_calls[0]
        tool_name = first_tool_call["name"]
        tool_args = first_tool_call["args"]
        
        # Run HITL evaluation for this tool call
        hitl_decision = evaluate_hitl(
            task_name=tool_name,
            tool_args=tool_args,
            user_input=user_input,
            tenant_id=tenant_id,
        )
        
        if hitl_decision.requires_hitl:
            # HITL triggered — save the tool call and ask for human approval
            tenant_state["pending_tool_call"] = first_tool_call
            
            friendly_names = {
                "process_top_up": "process a premium top-up",
                "get_claim_status": "retrieve your claim status details",
                "register_claim_details": "register your claim details in our system"
            }
            action_name = friendly_names.get(tool_name, tool_name)
            
            # Build a context-aware HITL message explaining why approval is needed
            trigger_type = hitl_decision.trigger_type  # "action", "response", "context"
            trigger_reason = hitl_decision.reason or "Security policy requires human approval."
            
            hitl_message = (
                f"✅ I'm ready to **{action_name}**.\n\n"
                f"⚠️ **Human approval needed** ({trigger_type}-based trigger): {trigger_reason}\n\n"
                f"Would you like to proceed? Reply 'Yes' to confirm or 'No' to cancel."
            )
            
            print(f"\n[HITL TRIGGERED] {trigger_type}: {trigger_reason}")
            
            # Send email notification (async, best-effort)
            notify_hitl_triggered(
                tenant_id=tenant_id,
                decision=hitl_decision,
                tool_name=tool_name,
                tool_args=tool_args,
            )
            
            return {
                "response": hitl_message,
                "hitl_pending": True,
                "hitl_action": tool_name,
                "hitl_reason": trigger_reason,
                "hitl_args": tool_args,
                "tool_executed": None,
                "tool_output": None,
            }
        else:
            # HITL not required — execute the tool directly
            print(f"\n[HITL SKIPPED] Tool '{tool_name}' passed all HITL checks. Executing directly.")
            
            # Build toolkits and execute
            toolkits_local, llm_with_tools_local = build_toolkits_for_tenant(tenant_id, mode=effective_mode)
            all_available_tools = [tool for tools in toolkits_local.values() for tool in tools]
            tool_map = {tool.name: tool for tool in all_available_tools}
            
            if tool_name in tool_map:
                try:
                    tool_output = tool_map[tool_name].invoke(tool_args)
                except Exception as exc:
                    tool_output = f"The task '{tool_name}' needs more details before it can run: {exc}"
            else:
                tool_output = f"Error: Tool '{tool_name}' not found."
            
            print(f"[✅ TOOL EXECUTED]: {tool_output}")
            
            # Let the AI inform the user about the result
            final_prompt = f"The system successfully executed the tool '{tool_name}'. Output: {tool_output}. Inform the user about the result."
            messages = [get_dynamic_system_prompt(tenant_id, customer_id, datatype=effective_mode), HumanMessage(content=final_prompt)]
            response_obj = heavy_llm.invoke(messages)
            return {
                "response": _clean_final_output(extract_text(response_obj.content)),
                "hitl_pending": False,
                "tool_executed": tool_name,
                "tool_output": tool_output,
            }

    # If it's just a general question with no tool intent, reply normally
    full_output = extract_text(response_obj.content)
    # FIX: Always run output cleaning so <thinking>/<reflection> content can
    # never blend into the user-visible answer (see _clean_final_output).
    raw_response = _clean_final_output(full_output)
    
    session_history.add_user_message(user_input)
    session_history.add_ai_message(raw_response)
    
    return {
        "response": raw_response,
        "hitl_pending": False,
        "tool_executed": None,
        "tool_output": None,
    }

# ==========================================
# 7. RAGAS Evaluation System (Replaced custom evaluate_performance with advanced_prototype's RAGAS approach)
# ==========================================
def evaluate_performance(question, context, answer):
    """
    Evaluates AI response quality using RAGAS metrics (Faithfulness, AnswerRelevancy, ContextPrecision).
    Replaces the old LLM-as-a-judge approach with proper RAGAS evaluation from advanced_prototype.
    """
    scores = {}
    try:
        # 1. Initialize Ragas Wrappers for LangChain models
        ragas_llm = LangchainLLMWrapper(cheap_llm)
        ragas_embeddings = LangchainEmbeddingsWrapper(embeddings)

        # 2. Build the dataset using the modern EvaluationDataset approach
        dataset = EvaluationDataset.from_list([{
            "user_input": question,
            "response": answer,
            "retrieved_contexts": [context]
        }])
            
        # 3. Use legacy metrics from ragas.metrics which accept LangChain LLMs directly
        from ragas.metrics import Faithfulness, AnswerRelevancy, LLMContextPrecisionWithoutReference
            
        metrics = [
            Faithfulness(llm=cheap_llm),
            AnswerRelevancy(llm=cheap_llm, embeddings=embeddings),
            LLMContextPrecisionWithoutReference(llm=cheap_llm),
        ]
            
        # 4. Pass the wrappers explicitly into the evaluate function
        eval_result = evaluate(
            dataset=dataset,
            metrics=metrics,
            llm=ragas_llm,
            embeddings=ragas_embeddings
        )
        
        if hasattr(eval_result, "to_pandas"):
            scores = eval_result.to_pandas().to_dict(orient="records")[0]
        else:
            scores = dict(eval_result)
            
        print("RAGAS Scorecard generated successfully.")
    except Exception as e:
        print(f"WARNING: Ragas evaluation run encountered an issue: {e}")
        scores = {"error": str(e)}
    
    # Extract individual scores for backward compatibility with the old return format
    faithfulness_score = scores.get("faithfulness", "N/A")
    relevance_score = scores.get("answer_relevancy", "N/A")
    
    # Convert float scores to 0-10 scale for backward compatibility if they're 0-1
    if isinstance(faithfulness_score, float) and faithfulness_score <= 1.0:
        faithfulness_score = round(faithfulness_score * 10, 1)
    if isinstance(relevance_score, float) and relevance_score <= 1.0:
        relevance_score = round(relevance_score * 10, 1)
    
    return faithfulness_score, relevance_score

# ==========================================
# 7.5 Dynamic Tool Generation
# ==========================================
def fetch_dynamic_tasks(tenant_id: str | None = None, mode: str | None = None):
    """Fetch dynamic task definitions for a given AI mode.

    Tasks are stored in the `customer-service-provider` table with
    datatype='agent_tasks' and filename=<mode>, so each AI mode has its own
    set of Agent Tasks (the same way each mode has its own knowledge base).
    """
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    if not rest_url:
        print("ERROR: CUSTOMER_SERVICE_PROVIDER env var is missing!")
        return []

    mode = mode or get_tenant_active_mode(tenant_id)
    query_url = (
        f"{rest_url}?filename=eq.{urllib.parse.quote(mode, safe='')}"
        f"&datatype=eq.agent_tasks"
    )
    if tenant_id:
        query_url += f"&tenant_id=eq.{tenant_id}"
    query_url += "&select=data&limit=1"

    headers = {
        "apikey": os.getenv("SUPADB_API"),
        "Authorization": f"Bearer {os.getenv('SUPADB_API')}"
    }

    try:
        response = requests.get(query_url, headers=headers, timeout=10)
        if response.status_code != 200:
            print(f"ERROR: Supabase returned {response.status_code}: {response.text}")
            return []

        rows = response.json() or []
        if not rows:
            return []

        raw = rows[0].get("data")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                raw = {}

        if isinstance(raw, dict):
            tasks = raw.get("tasks", [])
            if isinstance(tasks, list):
                return [t for t in tasks if isinstance(t, dict)]
        return []

    except Exception as e:
        print(f"CRITICAL ERROR in fetch_dynamic_tasks: {str(e)}")
        return []


def create_dynamic_tool(task_def):
    """Converts a JSON task definition into a LangChain StructuredTool."""
    name = task_def["name"]
    description = task_def["description"]
    endpoint = task_def["endpoint"]
    method = task_def["method"].upper()
    req_args = task_def.get("required_args", [])

    # FIX 1: Use `Any` instead of `str` so the LLM can output native floats and booleans natively.
    # The description guides the model to source values from context / memory instead of
    # interrogating the user for things it already knows.
    fields = {
        arg: (
            Any,
            Field(
                ...,
                description=(
                    f"Value for '{arg}'. If the user did not state it in their current message, "
                    "infer it from the conversation history or the user's known profile. "
                    "Only ask the user if it genuinely cannot be determined."
                ),
            ),
        )
        for arg in req_args
    }
    args_schema = create_model(f"{name}Schema", **fields)

    def tool_execution(**kwargs):
        url = endpoint
        payload = {}
        
        # Replace path variables and build payload
        for key, value in kwargs.items():
            if f"{{{key}}}" in url:
                url = url.replace(f"{{{key}}}", str(value))
            else:
                # FIX 2: Sanitize string currency values if the LLM hallucinates them
                if isinstance(value, str) and key == "amount":
                    clean_val = value.replace("$", "").replace(",", "").strip()
                    try:
                        value = float(clean_val)
                    except ValueError:
                        pass # Let FastAPI handle the validation error naturally
                
                # FIX 3: Flatten nested "request" objects if your DB specifies "request" as a required arg
                if key == "request" and isinstance(value, (dict, str)):
                    if isinstance(value, str) and value.strip().startswith("{"):
                        try:
                            payload.update(json.loads(value))
                        except json.JSONDecodeError:
                            payload[key] = value
                    elif isinstance(value, dict):
                        payload.update(value)
                    continue

                payload[key] = value

        try:
            if method == "GET":
                response = requests.get(url)
            elif method == "POST":
                response = requests.post(url, json=payload)
            else:
                return f"Unsupported HTTP method: {method}"
            
            # FIX 4: Better error logging to see EXACTLY why FastAPI rejected it
            if not response.ok:
                return f"API Validation Error ({response.status_code}): {response.text}"
                
            response.raise_for_status() 
            return f"Success. Response: {response.text}"
            
        except requests.exceptions.RequestException as e:
            return f"API Connection Error: {str(e)}"

    return StructuredTool.from_function(
        func=tool_execution,
        name=name,
        description=description,
        args_schema=args_schema
    )

# ==========================================
# 8. Chat Loop & Dynamic Tool Initialization
# ==========================================

print("\n--- Initializing Knowledge Bases ---")
def build_toolkits_for_tenant(tenant_id: str | None, mode: str | None = None):
    """Build dynamic toolkits and bound LLMs for the tenant's active AI mode (or a specific mode)."""
    active_mode = mode or get_tenant_active_mode(tenant_id)
    raw_tasks_data = fetch_dynamic_tasks(tenant_id, mode=active_mode)

    if isinstance(raw_tasks_data, str):
        tasks_json = _parse_json_object(raw_tasks_data).get("tasks", [])
    elif isinstance(raw_tasks_data, dict):
        tasks_json = raw_tasks_data.get("tasks", [])
    else:
        tasks_json = raw_tasks_data

    if not isinstance(tasks_json, list):
        tasks_json = []

    toolkits_local = {}

    for task in tasks_json:
        if not isinstance(task, dict):
            print(f"Skipping invalid task format: {task}")
            continue

        datatype = re.sub(r'[^a-z0-9_-]', '', str(task.get("datatype") or "general").lower()) or "general"

        try:
            langchain_tool = create_dynamic_tool(task)
        except Exception as exc:
            print(f"Skipping invalid task definition for datatype {datatype}: {exc}")
            continue

        toolkits_local.setdefault(datatype, []).append(langchain_tool)

    llm_with_tools_local = {
        datatype: heavy_llm.bind_tools(tools) if tools else heavy_llm
        for datatype, tools in toolkits_local.items()
    }

    # IMPORTANT: Add a combined '_all' key that binds ALL available tools.
    # This ensures the AI can call any tool regardless of which knowledge base
    # datatype the routing selected. Without this, if the task's datatype doesn't
    # match the knowledge base stream (e.g., tasks have datatype="ADMINISTRATION"
    # but documents use datatype="policies"), the LLM would have zero tools bound.
    all_tools = []
    for tools in toolkits_local.values():
        all_tools.extend(tools)
    llm_with_tools_local["_all"] = heavy_llm.bind_tools(all_tools) if all_tools else heavy_llm

    return toolkits_local, llm_with_tools_local


_retriever_cache: dict = {}  # {tenant_id: (timestamp, retrievers)}
_RETRIEVER_TTL_SECONDS = 60


def get_retrievers_for_tenant(tenant_id: str | None, mode: str | None = None):
    """Scans storage for each discovered datatype and runs preprocess() so any
    PDFs that haven't been parsed/embedded yet actually get sent through
    LlamaParse and inserted into the 'documents' vector table. preprocess()
    already skips files that are already embedded (via check_if_embedded),
    so this is safe to call every time - it's a no-op network check for
    files that were already processed, and a real parse for new ones.

    Since the discovery/embedding checks are network calls, the result is
    cached for a short TTL so consecutive chat messages don't repeat the
    same Supabase scans on every request. New uploads still get picked up
    within the TTL window."""
    key = tenant_id or "global"
    now = time.monotonic()
    cached = _retriever_cache.get(key)
    if cached and (now - cached[0]) < _RETRIEVER_TTL_SECONDS:
        return cached[1]

    discovered = discover_datatypes(tenant_id)
    if mode:
        # Scope to a single AI mode: only that mode's knowledge base is made
        # available, so the AI can only talk about that mode.
        discovered = [d for d in discovered if d == mode]
    retrievers = {}

    for dt in discovered:
        retrievers[dt] = preprocess(tenant_id=tenant_id, datatype_label=dt)

    _retriever_cache[key] = (now, retrievers)
    return retrievers

def discover_datatypes(tenant_id: str | None):
    """Discover tenant datatypes from storage folders and indexed database rows."""
    # ✅ FIX: Use "global" instead of "" so the storage path and any downstream
    # operations never deal with an empty tenant scope.
    tenant_scope = tenant_id or "global"
    bucket_name = os.getenv("SUPABASE_BUCKET", "customer-service-provider")
    datatypes = set()

    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    if rest_url:
        query_url = f"{rest_url}?select=datatype&datatype=neq.tasks&datatype=neq.custom_instruction&datatype=neq.custom_instructions&datatype=neq.agent_tasks"
        if tenant_id:
            query_url += f"&tenant_id=eq.{tenant_id}"

        headers = {
            "apikey": os.getenv("SUPADB_API"),
            "Authorization": f"Bearer {os.getenv('SUPADB_API')}",
        }

        try:
            response = requests.get(query_url, headers=headers, timeout=10)
            if response.status_code == 200:
                for row in response.json() or []:
                    datatype = row.get("datatype")
                    if datatype:
                        datatypes.add(str(datatype).lower())
            else:
                print(f"WARNING: Failed to discover table datatypes: {response.status_code} {response.text}")
        except Exception as exc:
            print(f"WARNING: Failed to discover table datatypes: {exc}")

    list_path = tenant_scope.strip("/") if tenant_scope else ""
    try:
        objects = supabase.storage.from_(bucket_name).list(path=list_path)
    except Exception as exc:
        print(f"WARNING: Failed to list storage for discovery: {exc}")
        objects = []

    for obj in objects or []:
        name = (obj.get("name") or "").strip()
        if not name:
            continue

        if name.endswith("/"):
            segment = name.rstrip("/").split("/")[-1]
            datatypes.add(segment.lower())
        elif "/" in name:
            segment = name.split("/")[0]
            datatypes.add(segment.lower())
        elif "." not in name:
            datatypes.add(name.lower())

    cleaned = []
    for d in datatypes:
        safe = re.sub(r'[^a-z0-9_-]', '', d.lower())
        if safe and safe != "tasks":
            cleaned.append(safe)
    return sorted(cleaned)