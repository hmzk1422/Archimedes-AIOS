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

toolkit = []