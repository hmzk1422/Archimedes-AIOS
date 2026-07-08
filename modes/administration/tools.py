import os
import re
import json
import glob
import shutil
from dotenv import load_dotenv
import requests

from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_text_splitters import MarkdownHeaderTextSplitter
from langchain_chroma import Chroma
from langchain_community.chat_message_histories import FileChatMessageHistory
from langchain_core.tools import tool
from langchain_core.messages import ToolMessage

# ==========================================
# 1.5. Define Agent Tools (The Actions)
# ==========================================


load_dotenv()
API_BASE_URL = os.getenv("API_BASE_URL")

@tool
def get_claim_status(claim_id: str) -> str:
    """
    Fetches the real-time status of an insurance claim from the database. 
    Use this ONLY when the user asks about the status of a specific claim ID.
    """
    try:
        # Make a real HTTP GET request to the company API
        response = requests.get(f"{API_BASE_URL}/claims/{claim_id}")
        
        if response.status_code == 200:
            return json.dumps(response.json())
        else:
            return json.dumps({"error": f"API returned status {response.status_code}: {response.text}"})
    except requests.exceptions.ConnectionError:
        return json.dumps({"error": "Failed to connect to the Company API. Is the server running?"})

@tool
def process_top_up(policy_id: str, amount: float) -> str:
    """
    Processes a top-up payment for a Unit-Linked policy.
    Call this when the user explicitly confirms they want to add money to their policy.
    """
    try:
        # Make a real HTTP POST request with a JSON payload
        payload = {"amount": amount}
        response = requests.post(f"{API_BASE_URL}/policies/{policy_id}/top-up", json=payload)
        
        if response.status_code == 200:
            return response.json()["message"]
        return f"Error processing top-up: {response.text}"
    except Exception as e:
        return f"Network Error: {str(e)}"

@tool
def register_claim_details(incident_date: str, has_all_docs: bool) -> str:
    """
    Registers the claim details once the user confirms they have all documents and provides the incident date.
    """
    try:
        payload = {
            "incident_date": incident_date,
            "has_all_docs": has_all_docs
        }
        response = requests.post(f"{API_BASE_URL}/claims/register", json=payload)
        
        if response.status_code == 200:
            return response.json()["message"]
        return f"Error registering claim: {response.text}"
    except Exception as e:
        return f"Network Error: {str(e)}"

toolkit = [get_claim_status, process_top_up, register_claim_details]