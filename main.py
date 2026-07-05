import os
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_text_splitters import MarkdownHeaderTextSplitter
from langchain_chroma import Chroma

# 1. Setup the AI models (Connected to your local Ollama)
# Generator model (talks) and Embedding model (converts text to vector numbers)
llm = ChatOllama(model="llama3.2", base_url="http://localhost:11434")
embeddings = OllamaEmbeddings(model="nomic-embed-text", base_url="http://localhost:11434")

# 2. Initialize or Load the Vector Database
PERSIST_DIR = "./chroma_db"
POLICY_FILE = "knowledge/policies/legacy-pro.md"

if not os.path.exists(PERSIST_DIR):
    print("Building fresh Vector Database from Markdown file...")
    with open(POLICY_FILE, "r") as f:
        markdown_document = f.read()

    # Split the Markdown by its structural headers to keep sections intact
    headers_to_split_on = [
        ("#", "Header 1"),
        ("##", "Header 2"),
        ("###", "Header 3"),
    ]
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    md_header_splits = markdown_splitter.split_text(markdown_document)

    # Save vectors locally
    vectorstore = Chroma.from_documents(
        documents=md_header_splits,
        embedding=embeddings,
        persist_directory=PERSIST_DIR
    )
else:
    print("Loading existing Vector Database from local storage...")
    vectorstore = Chroma(persist_directory=PERSIST_DIR, embedding_function=embeddings)

# Setup the retriever to grab the top 2 most matching text blocks
retriever = vectorstore.as_retriever(search_kwargs={"k": 2})

# 3. Setup System Instructions and Conversation History
chat_history = [
    SystemMessage(content=(
        "You are an expert B2B Customer Service Agent. Use the provided policy context to answer questions.\n\n"
        "CRITICAL RULES:\n"
        "1. Pay close attention to distinct entities, ages, and monetary values mentioned by the user.\n"
        "2. Carefully map those entities to their explicit roles (e.g., separating the 'Applicant' from the 'Policyholder').\n"
        "3. Emphatize with users. Anger and sadness\n"
        "4. If the answer cannot be confidently verified by the context, say 'I need to check with a human'.\n"
        "You are NOT an authorized decision-maker for claim approvals, exceptions, or overrides. If a user asks for an exception to policy terms (e.g., deadlines, exclusions), you must NEVER promise or imply that one will be granted. Your role is to gather information and provide the correct process for requesting a formal review."
    ))
]

def ask_agent(user_input):
    # Retrieve ONLY the rules relevant to the current question
    relevant_chunks = retriever.invoke(user_input)
    context_for_ai = "\n\n".join([doc.page_content for doc in relevant_chunks])
    
    # Construct a clean, isolated context block for this turn
    prompt = f"""RELEVANT POLICY CONTEXT:
{context_for_ai}

CUSTOMER QUESTION: {user_input}"""
    
    # Add user question with context to history
    chat_history.append(HumanMessage(content=prompt))
    
    # Get response from the LLM
    response = llm.invoke(chat_history)
    
    # Save the AI's response to history to maintain conversational memory
    chat_history.append(AIMessage(content=response.content))
    
    return response.content

# 4. Run the Continuous Conversation Loop
print("\n--- AI Agent Initialized (Type 'quit' to exit) ---")

while True:
    try:
        # Get user input
        user_input = input("\nYou: ")
        
        # Check for exit condition
        if user_input.lower() in ["quit", "exit"]:
            print("Agent: Goodbye!")
            break
        
        # Get and print the response
        response = ask_agent(user_input)
        print(f"Agent: {response}")
        
    except KeyboardInterrupt:
        # Allows you to press Ctrl+C to exit cleanly
        print("\nAgent: Goodbye!")
        break
    except Exception as e:
        print(f"Agent: Sorry, I encountered an error: {e}")