import os
import re
import json
from dotenv import load_dotenv
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_text_splitters import MarkdownHeaderTextSplitter
from langchain_chroma import Chroma
from langchain_community.chat_message_histories import FileChatMessageHistory

# ==========================================
# 1. Setup AI Models
# ==========================================
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")

# Kept your original model choice here
llm = ChatGoogleGenerativeAI(model="gemini-3.1-flash-lite", google_api_key=api_key)
embeddings = OllamaEmbeddings(model="nomic-embed-text", base_url="http://localhost:11434")

def extract_text(content):
    """[NEW HELPER] Safely flattens LangChain/Gemini content blocks into a clean string."""
    if isinstance(content, list):
        return "".join([part.get("text", "") if isinstance(part, dict) else str(part) for part in content])
    return str(content)

# ==========================================
# 2. Vector Database Initialization
# ==========================================
PERSIST_DIR = "./chroma_db"
POLICY_FILE = "knowledge/policies/legacy-pro.md"

if not os.path.exists(PERSIST_DIR):
    print("Building fresh Vector Database from Markdown file...")
    try:
        with open(POLICY_FILE, "r") as f:
            markdown_document = f.read()
    except FileNotFoundError:
        markdown_document = "# Header 1\nDummy policy data for testing."

    headers_to_split_on = [("#", "Header 1"), ("##", "Header 2"), ("###", "Header 3")]
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    md_header_splits = markdown_splitter.split_text(markdown_document)

    vectorstore = Chroma.from_documents(documents=md_header_splits, embedding=embeddings, persist_directory=PERSIST_DIR)
else:
    print("Loading existing Vector Database from local storage...")
    vectorstore = Chroma(persist_directory=PERSIST_DIR, embedding_function=embeddings)

retriever = vectorstore.as_retriever(search_kwargs={"k": 5})

# ==========================================
# 3. Long-Term Memory Engine (User Profile)
# ==========================================
PROFILE_FILE = "memory/user_profile.json"
HISTORY_FILE = "memory/chat_history.json"

# Ensure memory directory exists
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
    except Exception as e:
        return current_profile

session_history = FileChatMessageHistory(HISTORY_FILE)

# ==========================================
# 4. Guardrailed System Prompt
# ==========================================
def get_dynamic_system_prompt():
    profile = load_user_profile()
    profile_text = json.dumps(profile, indent=2) if profile else "No user data collected yet."
    
    return SystemMessage(content=f"""You are a helpful, meticulous policy verification clerk for Legacy Pro insurance.

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
# 5. The Ask Agent Function
# ==========================================
def ask_agent(user_input):
    relevant_chunks = retriever.invoke(user_input)
    context_for_ai = "\n\n".join([doc.page_content for doc in relevant_chunks])
    
    current_profile = load_user_profile()
    extract_and_update_facts(user_input, current_profile)
    
    turn_payload = f"""CONTEXT FROM POLICY MANUAL:
{context_for_ai}

USER REQUEST: {user_input}

INSTRUCTIONS:
You must think step-by-step. Break your response into two distinct parts:
1. REASONING: Process numbers, math, or medical terms using context and KNOWN USER FACTS.
2. FINAL ANSWER: State the final determination clearly.
"""
    
    messages = [get_dynamic_system_prompt()] + session_history.messages + [HumanMessage(content=turn_payload)]
    
    response_obj = llm.invoke(messages)
    raw_response = extract_text(response_obj.content) # Safe parsing applied here
    
    session_history.add_user_message(user_input)
    session_history.add_ai_message(raw_response)
    
    return raw_response, context_for_ai

# ==========================================
# 6. LLM-As-A-Judge Evaluation System
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
    eval_response = extract_text(eval_obj.content) # Safe parsing applied here
    
    faithfulness_match = re.search(r'FAITHFULNESS:\s*(\d+)', eval_response, re.IGNORECASE)
    relevance_match = re.search(r'RELEVANCE:\s*(\d+)', eval_response, re.IGNORECASE)
    
    faithfulness_score = int(faithfulness_match.group(1)) if faithfulness_match else "N/A"
    relevance_score = int(relevance_match.group(1)) if relevance_match else "N/A"
    
    return faithfulness_score, relevance_score

# ==========================================
# 7. Chat Loop
# ==========================================
print("\n--- Upgraded Context & Memory Engine Initialized ---")

while True:
    try:
        user_input = input("\nYou: ")
        if user_input.lower() in ["quit", "exit"]:
            print("Agent: Goodbye!")
            break
        if not user_input.strip():
            continue
            
        print("\n[Thinking... Extracting Facts & Searching Policies...]")
        response, used_context = ask_agent(user_input)
        print(f"\nAgent:\n{response}")
        
        print("\n[Running Real-Time Telemetry...]")
        faith_score, rel_score = evaluate_performance(user_input, used_context, response)
        
        print("-" * 40)
        print(f"TELEMETRY METRICS:")
        print(f"► Faithfulness (Anti-Hallucination): {faith_score}/10")
        print(f"► Answer Relevance (Quality):        {rel_score}/10")
        if faith_score != "N/A" and int(faith_score) < 8:
            print("⚠️ WARNING: High hallucination risk detected in this turn.")
        print("-" * 40)
        
    except KeyboardInterrupt:
        print("\nAgent: Goodbye!")
        break
    except Exception as e:
        print(f"Agent: Error: {e}")