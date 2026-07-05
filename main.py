from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage

# 1. Load the knowledge base (Same as before)
with open("knowledge/policies/legacy-pro.md", "r") as f:
    knowledge = f.read()

# 2. Setup the AI (Connected to your local Ollama)
# Make sure your Llama model is pulled in Ollama (e.g., 'ollama pull llama3')
# Update your initialization to this:
llm = ChatOllama(
    model="llama3.2",
    base_url="http://localhost:11434" # Explicitly tell it where to look
)

def ask_agent(question):
    # Construct the prompt
    prompt = f"""
    You are a professional customer service agent. 
    Use the following company policy to answer the customer's question. 
    If the answer is not in the policy, say 'I need to check with a human'.
    
    POLICY:
    {knowledge}
    
    QUESTION: {question}
    """
    
    # Invoke the model
    response = llm.invoke([HumanMessage(content=prompt)])
    return response.content

# 3. Test it
print(ask_agent("Can I return my shirt after 10 days?"))
