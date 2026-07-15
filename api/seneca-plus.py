import os
import re
import json
import glob
import shutil
import urllib.parse
import requests
import tempfile
from dotenv import load_dotenv

from llama_cloud import LlamaCloud

from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI
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

# ==========================================
# 1. Setup AI Models
# ==========================================
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")

llm = ChatGoogleGenerativeAI(model="gemini-3.1-flash-lite", google_api_key=api_key)
embeddings = OllamaEmbeddings(model="nomic-embed-text", base_url="http://localhost:11434")

def extract_text(content):
    """Safely flattens LangChain/Gemini content blocks into a clean string."""
    if isinstance(content, list):
        return "".join([part.get("text", "") if isinstance(part, dict) else str(part) for part in content])
    return str(content)

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
    query_parts = [f"filename=eq.{base_name}", f"datatype=eq.{datatype_label}"]

    if tenant_id:
        query_parts.append(f"tenant_id=eq.{tenant_id}")

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
    if tenant_id:
        metadata_filter["tenant_id"] = tenant_id
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
    query_parts = [f"filename=eq.{base_name}", f"datatype=eq.{datatype_label}"]
    if tenant_id:
        query_parts.append(f"tenant_id=eq.{tenant_id}")
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
        query_url = f"{rest_url}?filename=eq.{base_name}&datatype=eq.{datatype_label}&tenant_id=eq.{tenant_id}&select=id"
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
        document_query = f"metadata->>tenant_id=eq.{tenant_id}&metadata->>datatype=eq.{datatype_label}&metadata->>source=eq.{base_name}"  
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

def preprocess(tenant_id=None, datatype_label="policies"):
    print(f"\n--- Processing PDFs from Supabase Storage for {datatype_label.upper()} ---")

    # 🌟 FIXED: Defined at the absolute top so nested functions can access it
    SUPABASE_KEY = os.getenv("SUPADB_API") 

    client = LlamaCloud()
    md_header_splits = []

    headers_to_split_on = [("#", "Header 1"), ("##", "Header 2"), ("###", "Header 3")]
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)

    tenant_scope = tenant_id or ""

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

            md_already_parsed = check_if_md_exists(base_name, datatype_label, tenant_id=tenant_scope or None)
            embeddings_already_exist = check_if_embedded(base_name, datatype_label, tenant_id=tenant_scope or None)

            if md_already_parsed and embeddings_already_exist:
                print(f"✅ {base_name} already parsed and embedded for this tenant. Skipping.")
                continue

            if md_already_parsed and not embeddings_already_exist:
                print(f"♻️ {base_name} MD exists but not embedded for this tenant — re-embedding without LlamaParse.")
                md_content = fetch_existing_md(base_name, datatype_label, tenant_id=tenant_scope or None)
                if not md_content:
                    print(f"⚠️ Could not load existing MD for {base_name}, skipping.")
                    continue
                splits = markdown_splitter.split_text(md_content)
                for split in splits:
                    split.metadata["source"] = base_name
                    split.metadata["datatype"] = datatype_label
                    split.metadata["tenant_id"] = tenant_scope
                md_header_splits.extend(splits)
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

            result = client.parsing.parse(
                file_id=file_obj.id,
                tier="agentic",
                version="latest",
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

    def process_database_only_entries(tenant_scope, datatype_label):
        """Fetches text directly from DB if it bypassed the storage bucket."""
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
        query_url = f"{rest_url}?datatype=eq.{datatype_label}&select=filename,data"
        if tenant_scope:
            query_url += f"&tenant_id=eq.{tenant_scope}"
                
        headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        response = requests.get(query_url, headers=headers)
        
        if response.status_code == 200:
            rows = response.json()
            for row in rows:
                base_name = row.get("filename")
                text_data = row.get("data")
                
                if check_if_embedded(base_name, datatype_label, tenant_scope):
                    continue
                    
                if text_data:
                    print(f"♻️ Chunking and embedding DB-only entry: {base_name}")
                    splits = markdown_splitter.split_text(text_data)
                    for split in splits:
                        split.metadata["source"] = base_name
                        split.metadata["datatype"] = datatype_label
                        split.metadata["tenant_id"] = tenant_scope
                    md_header_splits.extend(splits)

    process_database_only_entries(tenant_scope, datatype_label)

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

    filter_kwargs = {"datatype": datatype_label}
    if tenant_scope:
        filter_kwargs["tenant_id"] = tenant_scope

    retriever = vectorstore.as_retriever(
        search_kwargs={
            "k": 5,
            "filter": filter_kwargs
        }
    )
    return retriever


# ==========================================
# 4. Long-Term Memory Engine (User Profile)
# ==========================================
os.makedirs("memory", exist_ok=True)

def _profile_path_for(tenant_id: str | None, customer_id: str | None = None):
    key = f"{tenant_id or 'global'}_{customer_id or 'shared'}"
    return f"memory/user_profile_{key}.json"

def _history_path_for(tenant_id: str | None, customer_id: str | None = None):
    key = f"{tenant_id or 'global'}_{customer_id or 'shared'}"
    return f"memory/chat_history_{key}.json"

def load_user_profile(tenant_id: str | None = None, customer_id: str | None = None):
    PROFILE_FILE = _profile_path_for(tenant_id, customer_id)
    if os.path.exists(PROFILE_FILE):
        with open(PROFILE_FILE, "r") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}
    return {}

def save_user_profile(profile_data, tenant_id: str | None = None, customer_id: str | None = None):
    PROFILE_FILE = _profile_path_for(tenant_id, customer_id)
    with open(PROFILE_FILE, "w") as f:
        json.dump(profile_data, f, indent=4)


def extract_and_update_facts(user_input, current_profile, tenant_id: str | None = None):
    extractor_prompt = f"""You are a data extraction assistant. Look at the user's input and extract any hard personal facts (e.g., age, occupation, medical conditions, budget).
    
    Current User Profile: {json.dumps(current_profile)}
    User's New Message: "{user_input}"
    
    If there are new facts, merge them with the current profile and output ONLY valid JSON. 
    If there are no new facts, output the current profile exactly as it is, in valid JSON.
    Do not output any markdown formatting (like ```json). Just the raw JSON braces."""
    
    try:
        response = llm.invoke([HumanMessage(content=extractor_prompt)])
        raw_content = extract_text(response.content)
        clean_json_string = raw_content.strip().strip('`').replace('json\n', '', 1)
        updated_profile = json.loads(clean_json_string)
        save_user_profile(updated_profile, tenant_id)
        return updated_profile
    except Exception:
        return current_profile
        
# Cache of FileChatMessageHistory per tenant to avoid reopening files repeatedly
_session_history_cache: dict = {}

def get_session_history(tenant_id: str | None = None, customer_id: str | None = None):
    path = _history_path_for(tenant_id, customer_id)
    if path not in _session_history_cache:
        _session_history_cache[path] = FileChatMessageHistory(path)
    return _session_history_cache[path]

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
        response = llm.invoke([HumanMessage(content=router_prompt)])
        decision = extract_text(response.content).strip().lower()
        
        # Clean up the output to prevent routing errors
        decision = re.sub(r'[^a-z0-9_-]', '', decision)
        
        if decision in available_streams:
            return decision
    except Exception:
        pass
        
    # Safe fallback to the first available datatype
    return available_streams[0]

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


def get_tenant_system_message_template(tenant_id: str | None = None):
    if not tenant_id:
        return DEFAULT_SYSTEM_MESSAGE_TEMPLATE

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

        # 👇 THE FIX: Merge the custom instruction with the default template
        if isinstance(custom_instruction, str) and custom_instruction.strip():
            combined_template = f"""{DEFAULT_SYSTEM_MESSAGE_TEMPLATE}

TENANT CUSTOM INSTRUCTIONS:
{custom_instruction.strip()}
"""
            return combined_template
            
    except Exception as exc:
        print(f"WARNING: Failed to load tenant system message: {exc}")

    return DEFAULT_SYSTEM_MESSAGE_TEMPLATE


def get_dynamic_system_prompt(tenant_id: str | None = None, customer_id: str | None = None):
    profile = load_user_profile(tenant_id, customer_id)
    profile_text = json.dumps(profile, indent=2) if profile else "No user data collected yet."
    template = get_tenant_system_message_template(tenant_id)
    return SystemMessage(content=template.replace("{profile_text}", profile_text))

# ==========================================
# 6. The Ask Agent Function
# ==========================================
session_state = {
    "pending_tool_call": None,
}

def ask_agent(user_input, retrievers, tenant_id=None, customer_id=None):
    global session_state
    
    tenant_key = f"{tenant_id or 'global'}_{customer_id or 'shared'}"
    if not isinstance(session_state, dict):
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
            toolkits_local, llm_with_tools_local = build_toolkits_for_tenant(tenant_id)
            all_available_tools = [tool for tools in toolkits_local.values() for tool in tools]
            tool_map = {tool.name: tool for tool in all_available_tools}
            
            if tool_name in tool_map:
                tool_output = tool_map[tool_name].invoke(tool_args)
            else:
                tool_output = f"Error: Tool '{tool_name}' not found."

            # Print explicit terminal feedback so you know it worked
            print(f"[✅ DATABASE UPDATED]: {tool_output}")
            
            # Clear the gate state
            tenant_state["pending_tool_call"] = None
            
            # Let the AI know it was executed successfully
            final_prompt = f"The user confirmed the action. The system successfully executed the tool. Output: {tool_output}. Inform the user."
            messages = [get_dynamic_system_prompt(tenant_id, customer_id), HumanMessage(content=final_prompt)]
            response_obj = llm.invoke(messages)
            return extract_text(response_obj.content), "Tool Executed Successfully"
            
        else:
            # User said anything other than yes/confirm -> Abort!
            print("\n[❌ USER ABORTED: Action cancelled.]")
            tenant_state["pending_tool_call"] = None
            return "Action cancelled. I won't perform any changes to your policy.", "User Aborted Action"

    # ==========================================
    # 2. STANDARD CHAT / INTENT DETECTION FLOW
    # ==========================================
    
    available_streams = list(retrievers.keys())
    chosen_stream = get_routing_decision(user_input, available_streams)
    print(f"\n[AI Router selected FACT base: {chosen_stream.upper()}]")
    
    # 1. RETRIEVE HARD FACTS
    active_retriever = retrievers.get(chosen_stream)
    factual_chunks = active_retriever.invoke(user_input) if active_retriever else []
    
    # Optional: Apply your tenant filtering logic here to factual_chunks
    context_facts = "\n\n".join([doc.page_content for doc in factual_chunks])

    # 2. RETRIEVE EXPERIENCE / PLAYBOOKS (Dual-RAG)
    # Automatically check if you have a 'cases', 'playbooks', or 'experience' datatype
    experience_stream = next((s for s in available_streams if s in ['experience', 'cases', 'playbooks']), None)
    context_experience = "No historical case data available."
    
    if experience_stream:
        print(f"[AI Router selected EXPERIENCE base: {experience_stream.upper()}]")
        exp_retriever = retrievers.get(experience_stream)
        exp_chunks = exp_retriever.invoke(user_input) if exp_retriever else []
        context_experience = "\n\n".join([doc.page_content for doc in exp_chunks])

    # Combined RAG context (facts + experience) that was actually fed to the AI.
    # Kept around so it can be returned/logged from the HITL branch below.
    context_for_ai = f"[HARD FACTS / KNOWLEDGE]:\n{context_facts}\n\n[PAST EXPERIENCE / CASES]:\n{context_experience}"

    # Build tools
    toolkits_local, llm_with_tools_local = build_toolkits_for_tenant(tenant_id)
    active_llm = llm_with_tools_local.get(chosen_stream, llm)
    all_available_tools = toolkits_local.get(chosen_stream, [])

    if all_available_tools:
        tool_descriptions = "\n".join([f"- {t.name}: {t.description}" for t in all_available_tools])
    else:
        tool_descriptions = "No active tools available for this topic."

    # 3. THE UPGRADED PROMPT (Identity Guardrails + Dual Context + Confidence)
    turn_payload = f"""
    CRITICAL IDENTITY GUARDRAIL:
    You are a professional AI Assistant. The people, customers, and situations mentioned in the "PAST EXPERIENCE / CASES" or "FACTS" (e.g., 'Bapak Lutfy') are PAST EXAMPLES ONLY. 
    DO NOT assume the current user is them. DO NOT adopt their personas. Rely ONLY on the KNOWN USER FACTS for the current user's identity.

    [HARD FACTS / KNOWLEDGE]:
    {context_facts}

    [PAST EXPERIENCE / CASES]:
    {context_experience}

    USER REQUEST: "{user_input}"

    AVAILABLE TASKS:
    {tool_descriptions}

    INSTRUCTIONS:
    1. UNDERSTAND: Look at the Experience/Cases to understand HOW to handle this type of user request (e.g., what clarifying questions to ask).
    2. FACT-CHECK: Use the Hard Facts to ensure you are giving accurate policy information.
    3. CONFIDENCE CHECK: If the facts do not clearly answer the user's question, do not guess. Acknowledge the complexity.
    4. ACTION: If a tool matches the intent, call it immediately. Otherwise, respond conversationally based on the facts and experience.
    """
    
    session_history = get_session_history(tenant_id, customer_id)
    messages = [get_dynamic_system_prompt(tenant_id, customer_id)] + session_history.messages + [HumanMessage(content=turn_payload)]
    
    # Invoke model
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
            
            return hitl_message, context_for_ai
        else:
            # HITL not required — execute the tool directly
            print(f"\n[HITL SKIPPED] Tool '{tool_name}' passed all HITL checks. Executing directly.")
            
            # Build toolkits and execute
            toolkits_local, llm_with_tools_local = build_toolkits_for_tenant(tenant_id)
            all_available_tools = [tool for tools in toolkits_local.values() for tool in tools]
            tool_map = {tool.name: tool for tool in all_available_tools}
            
            if tool_name in tool_map:
                tool_output = tool_map[tool_name].invoke(tool_args)
            else:
                tool_output = f"Error: Tool '{tool_name}' not found."
            
            print(f"[✅ TOOL EXECUTED]: {tool_output}")
            
            # Let the AI inform the user about the result
            final_prompt = f"The system successfully executed the tool '{tool_name}'. Output: {tool_output}. Inform the user about the result."
            messages = [get_dynamic_system_prompt(tenant_id, customer_id), HumanMessage(content=final_prompt)]
            response_obj = llm.invoke(messages)
            return extract_text(response_obj.content), hitl_decision.to_dict()

    # If it's just a general question with no tool intent, reply normally
    raw_response = extract_text(response_obj.content)
    session_history.add_user_message(user_input)
    session_history.add_ai_message(raw_response)
    
    return raw_response, f"Facts: {chosen_stream} | Experience: {experience_stream}"

# ==========================================
# 7. LLM-As-A-Judge Evaluation System
# ==========================================
def evaluate_performance(question, context, answer):
    eval_prompt = f"""You are an impartial AI evaluation system. 
Evaluate the AI's response based on these metrics:

1. FAITHFULNESS (Hallucination Rate): Score 0 to 10.
2. RELEVANCE: Score 0 to 10. 
3. CONFIDENCE (Clarity & Assurance): Score 0 to 10.
   - 10 = The AI gave a definitive, clear answer based solidly on the text.
   - 5 = The AI answered, but used hedging language ("It seems like", "I think").
   - 0 = The AI explicitly stated it did not know, was confused, or deferred to a human.

[USER QUESTION]: {question}
[RETRIEVED CONTEXT]: {context}
[AI RESPONSE]: {answer}

Provide your evaluation in exactly this format:
FAITHFULNESS: <score>
RELEVANCE: <score>
CONFIDENCE: <score>
"""
    eval_obj = llm.invoke([HumanMessage(content=eval_prompt)])
    eval_response = extract_text(eval_obj.content)
    
    faithfulness = re.search(r'FAITHFULNESS:\s*(\d+)', eval_response)
    relevance = re.search(r'RELEVANCE:\s*(\d+)', eval_response)
    confidence = re.search(r'CONFIDENCE:\s*(\d+)', eval_response)
    
    return (
        int(faithfulness.group(1)) if faithfulness else "N/A",
        int(relevance.group(1)) if relevance else "N/A",
        int(confidence.group(1)) if confidence else "N/A"
    )
# ==========================================
# 7.5 Dynamic Tool Generation
# ==========================================
def fetch_dynamic_tasks(tenant_id: str | None = None):
    """Fetch dynamic task definitions from the CUSTOMER_SERVICE_PROVIDER endpoint.

    If tenant_id is provided, include it as a filter so each tenant can have
    its own set of dynamic tasks.
    """
    print("DEBUG: Entering fetch_dynamic_tasks...")
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    if not rest_url:
        print("ERROR: CUSTOMER_SERVICE_PROVIDER env var is missing!")
        return []

    query_url = f"{rest_url}?filename=eq.tasks&datatype=eq.tasks&select=data"
    if tenant_id:
        query_url += f"&tenant_id=eq.{tenant_id}"

    headers = {
        "apikey": os.getenv("SUPADB_API"),
        "Authorization": f"Bearer {os.getenv('SUPADB_API')}"
    }

    try:
        print(f"DEBUG: Requesting {query_url}")
        response = requests.get(query_url, headers=headers, timeout=10)
        print(f"DEBUG: Response status: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            print(f"DEBUG: Data received: {data}")
            if data:
                return data[0].get("data", [])
            else:
                print("DEBUG: Query returned empty list.")
        else:
            print(f"ERROR: Supabase returned {response.status_code}: {response.text}")

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

    # FIX 1: Use `Any` instead of `str` so the LLM can output native floats and booleans natively
    fields = {arg: (Any, Field(..., description=f"The {arg} required for the request")) for arg in req_args}
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
def build_toolkits_for_tenant(tenant_id: str | None):
    """Build dynamic toolkits and bound LLMs for every task datatype."""
    raw_tasks_data = fetch_dynamic_tasks(tenant_id)

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
        datatype: llm.bind_tools(tools) if tools else llm
        for datatype, tools in toolkits_local.items()
    }

    return toolkits_local, llm_with_tools_local


def get_retrievers_for_tenant(tenant_id: str | None):
    """Create and return retrievers scoped to a specific tenant id.

    This builds per-datatype retrievers by running the preprocess flow
    for the requested tenant. It avoids running a global preprocessing pass
    at module import time so new uploads are associated with the correct
    tenant id.
    """
    discovered = discover_datatypes(tenant_id)

    retrievers = {}
    for dt in discovered:
        try:
            retrievers[dt] = preprocess(tenant_id=tenant_id, datatype_label=dt)
        except Exception as e:
            print(f"⚠️ Failed to build retriever for {dt}: {e}")
    return retrievers


def discover_datatypes(tenant_id: str | None):
    """Discover tenant datatypes from storage folders and indexed database rows."""
    tenant_scope = tenant_id or ""
    bucket_name = os.getenv("SUPABASE_BUCKET", "customer-service-provider")
    datatypes = set()

    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    if rest_url:
        query_url = f"{rest_url}?select=datatype&datatype=neq.tasks"
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