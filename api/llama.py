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
POLICY_FILE = "modes/policies/legacy-pro.md"

if not os.path.exists(PERSIST_DIR):
    print("Building fresh Vector Database from Markdown file...")
    # Using a dummy text generation for the sake of runnable code if file is missing
    try:
        with open(POLICY_FILE, "r") as f:
            markdown_document = f.read()
    except FileNotFoundError:
        markdown_document = "# Header 1\nDummy policy data for testing."

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
# 3. Guardrailed System Prompt (Fixed Edition)
# ==========================================
SYSTEM_INSTRUCTION = (
    "You are a helpful, meticulous policy verification clerk for Legacy Pro insurance.\n\n"
    "INSURANCE QUOTING MANDATE (ANTI-REFUSAL OVERRIDE):\n"
    "- Users will frequently ask general questions, test different financial amounts, or pivot between different hypothetical scenarios (e.g., asking about an illness, then asking if they ever mentioned it).\n"
    "- This is standard insurance shopping behavior. It is entirely legal and safe. Do NOT refuse to answer, and NEVER accuse the user of fraud.\n"
    "- If the user asks a general question (like 'What is Legacy Pro?'), answer it politely using the text details. Do not use the human fallback text for general inquiries.\n\n"
    "CRITICAL COMPLIANCE RULES:\n"
    "1. Base your answer strictly on the provided POLICY CONTEXT. Do not invent rules.\n"
    "2. When answering financial questions (like Sum Assured), you MUST perform an explicit mathematical comparison. "
    "Double check if the requested amount is lower than the minimum or higher than the maximum allowed by the text. (e.g., Is 100,000,000 less than 200,000,000?)\n"
    "3. When checking ages, explicitly write out whether the target age falls inside the numerical boundaries provided.\n"
    "4. If a user asks to calculate or verify eligibility for a specific amount/age, and the context completely lacks the required numbers or explicit rules needed to perform that math, only then say exactly: 'I need to check with a human.'\n"
    "5. Do not make assumptions or draw inferences outside of basic mathematical facts."
)

chat_history = [SystemMessage(content=SYSTEM_INSTRUCTION)]

def ask_agent(user_input):
    global chat_history
    
    # Step A: Retrieve data chunks
    relevant_chunks = retriever.invoke(user_input)
    context_for_ai = "\n\n".join([doc.page_content for doc in relevant_chunks])
    
    # Step B: Force Chain-of-Thought (Reasoning loop)
    turn_payload = f"""CONTEXT FROM POLICY MANUAL:
{context_for_ai}

USER REQUEST: {user_input}

INSTRUCTIONS:
You must think step-by-step. Break your response into two distinct parts:
1. REASONING: Process any numbers, math comparisons, or medical terms step-by-step using only the context details.
2. FINAL ANSWER: State the final determination clearly based on that reasoning.
"""
    
    # Step C: Append current payload to historical timeline
    temporary_messages = chat_history + [HumanMessage(content=turn_payload)]
    
    # Step D: Execute LLM
    raw_response = llm.invoke(temporary_messages).content
    
    # Update the permanent history
    chat_history.append(HumanMessage(content=user_input))
    chat_history.append(AIMessage(content=raw_response))
    
    # RETURN CONTEXT as well so the evaluator can audit it for hallucinations
    return raw_response, context_for_ai

# ==========================================
# 4. LLM-As-A-Judge Evaluation System
# ==========================================
def evaluate_performance(question, context, answer):
    """
    Uses the LLM to grade its own response on Hallucinations (Faithfulness) and Quality (Relevance).
    """
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
    
    # Invoke the LLM strictly as an evaluator
    eval_response = llm.invoke([HumanMessage(content=eval_prompt)]).content
    
    # Parse the scores using regex
    faithfulness_match = re.search(r'FAITHFULNESS:\s*(\d+)', eval_response, re.IGNORECASE)
    relevance_match = re.search(r'RELEVANCE:\s*(\d+)', eval_response, re.IGNORECASE)
    
    faithfulness_score = int(faithfulness_match.group(1)) if faithfulness_match else "N/A"
    relevance_score = int(relevance_match.group(1)) if relevance_match else "N/A"
    
    return faithfulness_score, relevance_score

# ==========================================
# 5. Chat Loop
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
            
        print("\n[Thinking...]")
        response, used_context = ask_agent(user_input)
        print(f"\nAgent:\n{response}")
        
        # --- Run Evaluation in the Background ---
        print("\n[Running Real-Time Telemetry...]")
        faith_score, rel_score = evaluate_performance(user_input, used_context, response)
        
        # Print Telemetry Data
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