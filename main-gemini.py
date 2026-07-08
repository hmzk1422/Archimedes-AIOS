import os
import re
import json
import glob
import shutil
import urllib.parse
import requests
import tempfile
from dotenv import load_dotenv

from docling.document_converter import DocumentConverter
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat

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

from modes.policies.tools import toolkit as policies_toolkit
from modes.administration.tools import toolkit as admin_toolkit

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

def check_if_md_exists(base_name, datatype_label):
    """Queries Supabase to see if the MD content for this file already exists."""
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    query_url = f"{rest_url}?filename=eq.{base_name}&datatype=eq.{datatype_label}&select=id"
    
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


def preprocess(env_prefix="FILE", datatype_label="policies"):
    print(f"\n--- Processing PDFs directly from Supabase for {datatype_label.upper()} ---")
    
    client = LlamaCloud()
    md_header_splits = []
    
    headers_to_split_on = [("#", "Header 1"), ("##", "Header 2"), ("###", "Header 3")]
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)

    # 1. Stream files dynamically from .env
    for key, url in os.environ.items():
        if key.startswith(env_prefix) and url:
            try:
                parsed_url = urllib.parse.urlparse(url)
                base_name = os.path.basename(parsed_url.path).replace('.pdf', '')
                
                # ==========================================
                # NEW: Check if file already exists in DB
                # ==========================================
                if check_if_md_exists(base_name, datatype_label):
                    print(f"✅ {base_name} already exists in Supabase. Skipping LlamaParse.")
                    continue
                
                print(f"Downloading {base_name}.pdf into memory from Supabase...")
                response = requests.get(url)
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
                
                # Compile the structural markdown into memory
                md_content = "\n\n".join([page.markdown for page in result.markdown.pages])
                
                # ==========================================
                # NEW: Save Raw Markdown via REST API
                # ==========================================
                print("Saving raw Markdown to Supabase table...")
                rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
                rest_headers = {
                    "apikey": os.getenv("SUPADB_API"),
                    "Authorization": f"Bearer {os.getenv('SUPADB_API')}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                }
                
                # Added 'filename' to the payload so we can check for it next time
                payload = {
                    "data": md_content,
                    "datatype": datatype_label,
                    "filename": base_name 
                }
                rest_response = requests.post(rest_url, json=payload, headers=rest_headers)
                
                if rest_response.status_code in [200, 201]:
                    print(f"✅ Successfully inserted raw {base_name}.md into Supabase.")
                else:
                    print(f"⚠️ Failed to insert raw MD: {rest_response.text}")

                # ==========================================
                # NEW: Chunk and prepare for pgvector
                # ==========================================
                splits = markdown_splitter.split_text(md_content)
                for split in splits:
                    split.metadata["source"] = base_name
                    split.metadata["datatype"] = datatype_label
                
                md_header_splits.extend(splits)

            except Exception as e:
                print(f"❌ Failed to process {url}. Error: {e}")

    # ==========================================
    # 2. Vector Database Initialization (pgvector)
    # ==========================================
    print(f"\n--- Initializing pgvector in Supabase for {datatype_label.upper()} ---")
    
    # Define SUPABASE_KEY locally if not globally defined for the SupabaseVectorStore
    SUPABASE_KEY = os.getenv("SUPADB_API")
        
    # CHANGE THIS SPECIFIC BLOCK IN YOUR PREPROCESS FUNCTION
    if md_header_splits:
        vectorstore = SupabaseVectorStore.from_documents(
            md_header_splits,
            embeddings,
            client=supabase,
            table_name="documents",      
            query_name="match_documents"
        )
    else:
        # Explicitly use the vectorstore constructor to avoid 'id' ambiguity 
        # during initialization
        vectorstore = SupabaseVectorStore(
            embedding=embeddings,
            client=supabase,
            table_name="documents",
            query_name="match_documents"
        )

    # Return the retriever scoped to the specific datatype using metadata filtering
    retriever = vectorstore.as_retriever(
        search_kwargs={
            "k": 5, 
            "filter": {"datatype": datatype_label}
        }
    )
    return retriever

# ==========================================
# 4. Long-Term Memory Engine (User Profile)
# ==========================================
PROFILE_FILE = "memory/user_profile.json"
HISTORY_FILE = "memory/chat_history.json"
os.makedirs("memory", exist_ok=True)

def load_user_profile():
    if os.path.exists(PROFILE_FILE):
        with open(PROFILE_FILE, "r") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}
    return {}

def save_user_profile(profile_data):
    with open(PROFILE_FILE, "w") as f:
        json.dump(profile_data, f, indent=4)

def extract_and_update_facts(user_input, current_profile):
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
        save_user_profile(updated_profile)
        return updated_profile
    except Exception:
        return current_profile

session_history = FileChatMessageHistory(HISTORY_FILE)

# ==========================================
# 5. Guardrailed System Prompt & Information Routing
# ==========================================

def get_routing_decision(user_input):
    """Uses the LLM to categorize the user's intent to route to the correct database."""
    router_prompt = f"""You are an intelligent routing assistant for an insurance bot.
    Analyze the user's input and categorize it into exactly one of these two streams:
    - "policies": Questions about products, coverage, benefits, quotes, or general rules.
    - "administration": Questions about filing claims, updating personal details, billing, or account management.

    User Input: "{user_input}"
    
    Respond with ONLY the exact word "policies" or "administration". No other text, no markdown."""
    
    try:
        response = llm.invoke([HumanMessage(content=router_prompt)])
        decision = extract_text(response.content).strip().lower()
        
        # Fallback handling just in case the LLM gets chatty
        if "admin" in decision or "claim" in decision:
            return "administration"
        return "policies" 
    except Exception:
        return "policies" # Default safe fallback

def get_dynamic_system_prompt():
    profile = load_user_profile()
    profile_text = json.dumps(profile, indent=2) if profile else "No user data collected yet."
    
    return SystemMessage(content=f"""You are a helpful, meticulous policy verification clerk for an insurance agency offering multiple plans.

KNOWN USER FACTS (LONG-TERM MEMORY):
{profile_text}
(Use these facts automatically if they are relevant to the user's questions, like age calculations).

INSURANCE QUOTING MANDATE (ANTI-REFUSAL OVERRIDE):
- Users will frequently ask general questions, test different financial amounts, or pivot between scenarios.
- Do NOT refuse to answer, and NEVER accuse the user of fraud.

CRITICAL COMPLIANCE RULES:
1. Base your answer strictly on the provided POLICY CONTEXT and the KNOWN USER FACTS.
2. When answering financial questions, you MUST perform an explicit mathematical comparison. 
3. When checking ages, explicitly write out whether the target age falls inside the boundaries.
4. If the context lacks the required numbers to perform math, say: 'I need to check with a human.'
""")

# ==========================================
# 6. The Ask Agent Function
# ==========================================

session_state = {
    "pending_tool_call": None,  # Stores the tool data when waiting for confirmation
}
def ask_agent(user_input, retrievers):
    global session_state
    
    # ==========================================
    # 1. GATE CHECK (Pending Tool Confirmation)
    # ==========================================
    if session_state["pending_tool_call"] is not None:
        if user_input.lower() in ["yes", "y", "confirm", "proceed", "sure"]:
            # User gave explicit permission! Run the saved tool.
            tool_call = session_state["pending_tool_call"]
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]
            
            print(f"\n[🔒 USER CONFIRMED: Executing {tool_name} with arguments {tool_args}...]")
            
            # Map and execute the function
            tool_map = {tool.name: tool for tool in toolkits}
            tool_output = tool_map[tool_name].invoke(tool_args)
            
            # Print explicit terminal feedback so you know it worked
            print(f"[✅ DATABASE UPDATED]: {tool_output}")
            
            # Clear the gate state
            session_state["pending_tool_call"] = None
            
            # Let the AI know it was executed successfully
            final_prompt = f"The user confirmed the action. The system successfully executed the tool. Output: {tool_output}. Inform the user."
            messages = [get_dynamic_system_prompt(), HumanMessage(content=final_prompt)]
            response_obj = llm.invoke(messages)
            return extract_text(response_obj.content), "Tool Executed Successfully"
            
        else:
            # User said anything other than yes/confirm -> Abort!
            print("\n[❌ USER ABORTED: Action cancelled.]")
            session_state["pending_tool_call"] = None
            return "Action cancelled. I won't perform any changes to your policy.", "User Aborted Action"

    # ==========================================
    # 2. STANDARD CHAT / INTENT DETECTION FLOW
    # ==========================================
    
    # 🌟 NEW: Route the query dynamically!
    chosen_stream = get_routing_decision(user_input)
    print(f"\n[AI Router selected knowledge base: {chosen_stream.upper()}]")
    
    active_retriever = retrievers[chosen_stream]
    active_llm = llm_with_tools[chosen_stream] # Select the bound LLM
    
    relevant_chunks = active_retriever.invoke(user_input)
    context_for_ai = "\n\n".join([doc.page_content for doc in relevant_chunks])
    
    # UPDATED: Instruct the AI to STOP talking and call the tool when data is ready
    turn_payload = f"""CONTEXT FROM POLICY MANUAL:
{context_for_ai}

USER REQUEST: {user_input}

CRITICAL RULES FOR MULTI-STEP ACTIONS (LIKE CLAIMS):
1. DATA GATHERING: If the user wants to lodge a claim, ask for the 'incident_date' and if they have all documents ready.
2. EXECUTION: Once the user provides the date and confirms document readiness, YOU MUST IMMEDIATELY CALL THE `register_claim_details` TOOL. Do NOT ask any more questions. 
3. Because of the security gate, do NOT perform the tool call yet if you are just thinking. Only output the tool call when you are ready to execute.
"""
    
    messages = [get_dynamic_system_prompt()] + session_history.messages + [HumanMessage(content=turn_payload)]
    
    # Ask the model what it wants to do
    response_obj = active_llm.invoke(messages)

    # ==========================================
    # 3. INTERCEPT THE TRIGGER-HAPPY AI
    # ==========================================
    if response_obj.tool_calls:
        # The AI *wants* to run a tool. We catch it here and freeze it!
        first_tool_call = response_obj.tool_calls[0]
        
        # Save the tool call details in our state instead of running it!
        session_state["pending_tool_call"] = first_tool_call
        
        # Override the response and force the AI to ask the user
        friendly_names = {
            "process_top_up": "process a premium top-up",
            "get_claim_status": "retrieve your claim status details",
            "register_claim_details": "register your claim details in our system"
        }
        action_name = friendly_names.get(first_tool_call["name"], first_tool_call["name"])
        
        return f"I am ready to {action_name}. To ensure security, do you explicitly want me to proceed with this action? Please type 'Yes' to confirm.", context_for_ai

    # If it's just a general question with no tool intent, reply normally
    raw_response = extract_text(response_obj.content)
    session_history.add_user_message(user_input)
    session_history.add_ai_message(raw_response)
    
    return raw_response, context_for_ai

# ==========================================
# 7. LLM-As-A-Judge Evaluation System
# ==========================================
def evaluate_performance(question, context, answer):
    eval_prompt = f"""You are an impartial AI evaluation system. 
Your task is to score the AI's response based on the provided user question and retrieved context.

Evaluate based on these two metrics:
1. FAITHFULNESS (Hallucination Rate): Score 0 to 10. 
   - 10 = The answer is entirely derived from the context. No external facts or invented rules were used.
   - 0 = Complete hallucination. The AI invented information not present in the context.
2. RELEVANCE: Score 0 to 10. 
   - 10 = The final answer perfectly and directly addresses the user's question.
   - 0 = The answer is entirely off-topic or fails to answer the question.

[USER QUESTION]: {question}
[RETRIEVED CONTEXT]: {context}
[AI RESPONSE]: {answer}

Provide your evaluation in exactly this format, with no other text:
FAITHFULNESS: <score>
RELEVANCE: <score>
"""

    eval_obj = llm.invoke([HumanMessage(content=eval_prompt)])
    eval_response = extract_text(eval_obj.content)
    
    faithfulness_match = re.search(r'FAITHFULNESS:\s*(\d+)', eval_response, re.IGNORECASE)
    relevance_match = re.search(r'RELEVANCE:\s*(\d+)', eval_response, re.IGNORECASE)
    
    faithfulness_score = int(faithfulness_match.group(1)) if faithfulness_match else "N/A"
    relevance_score = int(relevance_match.group(1)) if relevance_match else "N/A"
    
    return faithfulness_score, relevance_score

# ==========================================
# 8. Chat Loop
# ==========================================

print("\n--- Initializing Knowledge Bases ---")
retrievers = {
    "policies": preprocess(
        env_prefix="FILE", 
        datatype_label="policies"
    ),
    "administration": preprocess(
        env_prefix="ADMIN_FILE", 
        datatype_label="administration"
    )
}

# 🌟 NEW: Create a dictionary of toolkits
toolkits = {
    "policies": policies_toolkit,
    "administration": admin_toolkit
}

# 🌟 NEW: Bind the tools specifically to different instances of the LLM
llm_with_tools = {
    "policies": llm.bind_tools(policies_toolkit) if policies_toolkit else llm,
    "administration": llm.bind_tools(admin_toolkit) if admin_toolkit else llm
}

# Unify memory so context isn't lost if they switch between policies and administration
PROFILE_FILE = "memory/unified_user_profile.json"
HISTORY_FILE = "memory/unified_chat_history.json"
session_history = FileChatMessageHistory(HISTORY_FILE)

print("\n--- Upgraded Context & Memory Engine Initialized ---")
print("Hello! Welcome to Allianz Customer Service. How can we help you today?")

while True:
    try:
        user_input = input("\nYou: ")
        if user_input.lower() in ["quit", "exit"]:
            print("Agent: Goodbye!")
            break
        if not user_input.strip():
            continue
            
        print("\n[Thinking... Extracting Facts & Searching Policies...]")
        # Pass the retrievers dictionary into the agent
        response, used_context = ask_agent(user_input, retrievers)
        
        print(f"\nAgent:\n{response}")
        
        print("\n[Running Real-Time Telemetry...]")
        faith_score, rel_score = evaluate_performance(user_input, used_context, response)
        
        print("-" * 40)
        print(f"TELEMETRY METRICS:")
        print(f"► Faithfulness: {faith_score}/10")
        print(f"► Relevance:    {rel_score}/10")
        print("-" * 40)
        
    except KeyboardInterrupt:
        print("\nAgent: Goodbye!")
        break
    except Exception as e:
        print(f"Agent: Error: {e}")