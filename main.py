import os
import re
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_text_splitters import MarkdownHeaderTextSplitter
from langchain_chroma import Chroma

# ==========================================
# 1. Setup AI Models
# ==========================================
llm = ChatOllama(model="llama3.2", base_url="http://localhost:11434", temperature=0.0) # Set temp to 0.0 for strict logic
embeddings = OllamaEmbeddings(model="nomic-embed-text", base_url="http://localhost:11434")

# ==========================================
# 2. Vector Database Initialization
# ==========================================
PERSIST_DIR = "./chroma_db"
POLICY_FILE = "knowledge/policies/legacy-pro.md"

if not os.path.exists(PERSIST_DIR):
    print("Building fresh Vector Database from Markdown file...")
    with open(POLICY_FILE, "r") as f:
        markdown_document = f.read()

    headers_to_split_on = [
        ("#", "Header 1"),
        ("##", "Header 2"),
        ("###", "Header 3"),
    ]
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    md_header_splits = markdown_splitter.split_text(markdown_document)

    vectorstore = Chroma.from_documents(
        documents=md_header_splits,
        embedding=embeddings,
        persist_directory=PERSIST_DIR
    )
else:
    print("Loading existing Vector Database from local storage...")
    vectorstore = Chroma(persist_directory=PERSIST_DIR, embedding_function=embeddings)

retriever = vectorstore.as_retriever(search_kwargs={"k": 5})

# ==========================================
# 3. Guardrailed System Prompt (Anti-Fraud-Trigger Version)
# ==========================================
"""
SYSTEM_INSTRUCTION = (
    "You are a helpful and compliant Customer Service Assistant for Legacy Pro insurance. "
    "Your job is to assist users by checking policy rules, eligibility requirements, and financial limits using ONLY the provided context.\n\n"
    "SAFETY & COMPLIANCE MANDATE:\n"
    "- Users will frequently test different scenarios, change insurance amounts, or ask about different family members (e.g., switching from a child to themselves). "
    "- This is standard insurance quoting and shopping behavior. It is COMPLETELY LEGAL AND SAFE. It is NOT fraud.\n"
    "- NEVER accuse the user of fraud. Never refuse to answer standard eligibility questions.\n"
    "- If a user asks if a healthy person can get a policy, and the context allows it, you must answer 'Yes' regardless of what was discussed earlier in the conversation.\n\n"
    "CRITICAL RULES:\n"
    "1. Base your answer strictly on the provided POLICY CONTEXT. Do not invent rules.\n"
    "2. If a condition or parameter is explicitly allowed or excluded, state it clearly and politely.\n"
    "3. If the context does not contain enough specific data to answer, say exactly: 'I need to check with a human.'\n"
    "4. Maintain an objective, helpful customer support tone at all times."
)
"""
# ==========================================
# 3. Guardrailed System Prompt
# ==========================================
SYSTEM_INSTRUCTION = (
    "You are a meticulous policy verification clerk for Legacy Pro insurance.\n\n"
    "CRITICAL COMPLIANCE RULES:\n"
    "1. You have access to the conversation history and a localized context dump.\n"
    "2. When answering financial questions (like Sum Assured), you MUST perform an explicit mathematical comparison. "
    "Check if the requested amount is lower than the minimum or higher than the maximum allowed by the text.\n"
    "3. When checking ages, explicitly write out whether the target age falls inside the numerical boundaries provided.\n"
    "4. If the provided context does not contain a specific rule, number, or list item required to verify the user's eligibility, "
    "or if there is an ambiguity, you must say exactly: 'I need to check with a human.'\n"
    "5. Do not make assumptions or draw inferences outside of basic mathematical facts."
)

# FIXED: Global conversation state tracker
chat_history = [SystemMessage(content=SYSTEM_INSTRUCTION)]

def ask_agent(user_input):
    global chat_history
    
    # Step A: Retrieve data chunks
    relevant_chunks = retriever.invoke(user_input)
    context_for_ai = "\n\n".join([doc.page_content for doc in relevant_chunks])
    
    # Step B: Force Chain-of-Thought (Reasoning loop)
    # This instructs Llama to do its math visibly before answering, which cuts hallucinations by over 80%.
    turn_payload = f"""CONTEXT FROM POLICY MANUAL:
{context_for_ai}

USER REQUEST: {user_input}

INSTRUCTIONS:
You must think step-by-step. Break your response into two distinct parts:
1. REASONING: Process any numbers, math comparisons, or medical terms step-by-step using only the context details.
2. FINAL ANSWER: State the final determination clearly based on that reasoning.
"""
    
    # Step C: Append current payload to historical timeline
    # This prevents the "Amnesia" bug by letting the AI see previous turns.
    temporary_messages = chat_history + [HumanMessage(content=turn_payload)]
    
    # Step D: Execute LLM
    raw_response = llm.invoke(temporary_messages).content
    
    # Update the permanent history with clean user inputs and model responses
    chat_history.append(HumanMessage(content=user_input))
    chat_history.append(AIMessage(content=raw_response))
    
    return raw_response

# ==========================================
# 4. Chat Loop
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
            
        response = ask_agent(user_input)
        print(f"\nAgent:\n{response}")
        
    except KeyboardInterrupt:
        print("\nAgent: Goodbye!")
        break
    except Exception as e:
        print(f"Agent: Error: {e}")