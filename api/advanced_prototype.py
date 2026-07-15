import os
import re
from pathlib import Path
from typing import List, TypedDict
from dotenv import load_dotenv

# LangChain & Google GenAI
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_core.output_parsers import StrOutputParser

# Llama Cloud SDK (Parse API v2)
from llama_cloud import LlamaCloud

# LangGraph
from langgraph.graph import StateGraph, START, END

# RAGAS Core & Wrappers (The Fix for v0.2.0+)
from ragas import evaluate, EvaluationDataset
from ragas.llms import LangchainLLMWrapper
from ragas.embeddings import LangchainEmbeddingsWrapper

# Load environment variables
load_dotenv()

# =====================================================================
# 1. Pipeline State Definition
# =====================================================================
class RAGState(TypedDict):
    file_path: str               
    query: str                   
    raw_documents: List[Document]
    retrieved_docs: List[Document] 
    reranked_docs: List[Document]  
    extracted_context: str       
    reasoning_process: str       
    final_answer: str            
    evaluation_metrics: dict     

# =====================================================================
# 2. Setup AI Models (Cheap vs. Heavy)
# =====================================================================
cheap_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite", # Updated to current standard flash model
    google_api_key=os.getenv("GOOGLE_API_KEY"),
    temperature=0.1
)

heavy_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite", # Updated to current standard pro model
    google_api_key=os.getenv("GOOGLE_API_KEY"),
    temperature=0.2
)

embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001")

string_parser = StrOutputParser()

# =====================================================================
# 3. LangGraph Node Definitions
# =====================================================================

def parse_and_index_node(state: RAGState) -> dict:
    print("\n--- [1/6] Running Llama Cloud Document Parsing (v2 API) ---")
    file_path = state["file_path"]
    
    client = LlamaCloud(api_key=os.getenv("LLAMA_CLOUD_API_KEY"))
    uploaded_file = client.files.create(file=Path(file_path), purpose="parse")
    
    parse_result = client.parsing.parse(
        file_id=uploaded_file.id,
        tier="agentic",
        version="latest",
        expand=["markdown"]  
    )
    
    lc_docs = []
    for page in parse_result.markdown.pages:
        lc_docs.append(
            Document(
                page_content=page.markdown, 
                metadata={"source": file_path, "page_number": page.page_number}
            )
        )
    
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=200)
    split_docs = text_splitter.split_documents(lc_docs)
    
    print(f"Parsed & split document via Llama Cloud into {len(split_docs)} chunks.")
    return {"raw_documents": split_docs}


def retrieve_node(state: RAGState) -> dict:
    print("\n--- [2/6] Vector Database Retrieval ---")
    query = state["query"]
    docs = state["raw_documents"]
    
    vectorstore = Chroma.from_documents(documents=docs, embedding=embeddings)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 10})
    
    retrieved_docs = retriever.invoke(query)
    print(f"Retrieved {len(retrieved_docs)} candidate chunks from Vector Store.")
    return {"retrieved_docs": retrieved_docs}


def rerank_node(state: RAGState) -> dict:
    print("\n--- [3/6] LLM-based Reranking ---")
    query = state["query"]
    candidates = state["retrieved_docs"]
    
    rerank_prompt = """
    You are an expert information retriever. Analyze the relevance of the following document segment to the query.
    
    Query: {query}
    Document Segment:
    {doc_content}
    
    Respond with a relevance score from 0 to 100, followed by a one-sentence reasoning. 
    Format your response exactly like this:
    SCORE: [Your Score]
    REASONING: [Your Reason]
    """
    
    scored_docs = []
    rerank_chain = cheap_llm | string_parser

    for doc in candidates:
        formatted_prompt = rerank_prompt.format(query=query, doc_content=doc.page_content)
        response_text = rerank_chain.invoke([HumanMessage(content=formatted_prompt)])
        
        match = re.search(r"SCORE:\s*(\d+)", response_text)
        score = int(match.group(1)) if match else 0
        scored_docs.append((score, doc))
    
    scored_docs.sort(key=lambda x: x[0], reverse=True)
    selected_docs = [doc for score, doc in scored_docs[:4]]
    
    print(f"Reranked candidate chunks. Selected top {len(selected_docs)} documents.")
    return {"reranked_docs": selected_docs}


def extract_context_node(state: RAGState) -> dict:
    print("\n--- [4/6] Contextual Fact Extraction ---")
    query = state["query"]
    docs = state["reranked_docs"]
    
    context_str = "\n---\n".join([doc.page_content for doc in docs])
    
    extraction_prompt = f"""
    You are an advanced analyst. Read the following source materials and extract only the facts, figures, 
    statistics, and logical claims that are directly relevant to answering the question: "{query}".
    Do not add any analysis, speculation, or answers. Simply synthesize the raw facts into a clean, bulleted checklist.
    
    Source Material:
    {context_str}
    """
    
    extraction_chain = cheap_llm | string_parser
    response_text = extraction_chain.invoke([HumanMessage(content=extraction_prompt)])
    
    print("Extracted contextual facts successfully.")
    return {"extracted_context": response_text}


def generate_response_node(state: RAGState) -> dict:
    print("\n--- [5/6] Context-Aware Generation (CoT & Reflection) ---")
    query = state["query"]
    facts = state["extracted_context"]
    
    system_prompt = """
    You are an elite research AI. Your task is to solve the user's query using only the provided facts.
    You must format your internal thinking processes using structured XML blocks:
    
    <thinking>
    Step-by-step logic, drawing lines between the facts and the user's query. Discuss potential edge cases or assumptions.
    </thinking>
    
    <reflection>
    Analyze your reasoning in the thinking block. Are there logical gaps? Are there contradictions with the factual context?
    Did you assume something not directly stated in the context? Refine your strategy if necessary.
    </reflection>
    
    <final_answer>
    The ultimate, clear, complete, and correct output written for the user. Do not reference the XML blocks here.
    </final_answer>
    """
    
    user_prompt = f"""
    User Query: {query}
    
    Provided Facts:
    {facts}
    """
    
    generation_chain = heavy_llm | string_parser
    full_output = generation_chain.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt)
    ])
    
    final_answer_match = re.search(r"<final_answer>(.*?)</final_answer>", full_output, re.DOTALL)
    if final_answer_match:
        final_answer = final_answer_match.group(1).strip()
    else:
        final_answer = full_output 
        
    return {
        "reasoning_process": full_output,
        "final_answer": final_answer
    }


def evaluate_node(state: RAGState) -> dict:
    print("\n--- [6/6] RAGAS Evaluation Scorecard ---")
    query = state["query"]
    final_answer = state["final_answer"]
    contexts = [doc.page_content for doc in state["reranked_docs"]]
    
    scores = {}
    try:
        # 1. Initialize Ragas Wrappers for LangChain models
        ragas_llm = LangchainLLMWrapper(cheap_llm)
        ragas_embeddings = LangchainEmbeddingsWrapper(embeddings)

        # 2. Build the dataset using the modern EvaluationDataset approach
        dataset = EvaluationDataset.from_list([{
            "user_input": query,
            "response": final_answer,
            "retrieved_contexts": contexts
        }])
            
        # Use legacy metrics from ragas.metrics (not v2 collections) 
        # which accept LangChain LLMs directly and work with Gemini
        from ragas.metrics import Faithfulness, AnswerRelevancy, LLMContextPrecisionWithoutReference
            
        # 3. Pass the raw LangChain LLM directly (legacy metrics accept BaseLanguageModel)
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
        
    return {"evaluation_metrics": scores}


# =====================================================================
# 4. Construct the Workflow Graph
# =====================================================================
workflow = StateGraph(RAGState)

workflow.add_node("parse_and_index", parse_and_index_node)
workflow.add_node("retrieve", retrieve_node)
workflow.add_node("rerank", rerank_node)
workflow.add_node("extract_context", extract_context_node)
workflow.add_node("generate_response", generate_response_node)
workflow.add_node("evaluate", evaluate_node)

workflow.add_edge(START, "parse_and_index")
workflow.add_edge("parse_and_index", "retrieve")
workflow.add_edge("retrieve", "rerank")
workflow.add_edge("rerank", "extract_context")
workflow.add_edge("extract_context", "generate_response")
workflow.add_edge("generate_response", "evaluate")
workflow.add_edge("evaluate", END)

app = workflow.compile()


# =====================================================================
# 5. Pipeline Execution Test
# =====================================================================
if __name__ == "__main__":
    test_file = "sample.pdf"
    test_query = "What are the core performance metrics discussed in the document, and what are their specific numeric targets?"
    
    if not os.path.exists(test_file):
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("# Company Q4 System Metrics Report\n\n"
                    "We achieved our critical API response latency target of 120ms this quarter. "
                    "However, our system uptime performance was 99.95%, missing our historical goal of 99.99%.")
        print(f"Temporary file created for demonstration: '{test_file}'")

    inputs = {
        "file_path": test_file,
        "query": test_query
    }
    
    print(f"Starting pipeline execution with query: '{test_query}'")
    final_state = app.invoke(inputs)
    
    print("\n=========================================")
    print("         FINAL RESPONSE                  ")
    print("=========================================")
    print(f"\n[QUERY]: {final_state['query']}")
    print(f"\n[FINAL ANSWER]:\n{final_state['final_answer']}")
    print("\n=========================================")
    print("     DETAILED REASONING & REFLECTION    ")
    print("=========================================")
    print(final_state["reasoning_process"])
    print("\n=========================================")
    print("           RAGAS SCORECARD               ")
    print("=========================================")
    for metric, score in final_state["evaluation_metrics"].items():
        if metric not in ["user_input", "response", "retrieved_contexts", "question", "contexts", "answer"]:
            print(f"{metric}: {score}")