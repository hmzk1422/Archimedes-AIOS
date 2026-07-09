from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from gemini import ask_agent, retrievers 

# 1. CREATE THE APP FIRST
app = FastAPI()

# 2. THEN CONFIGURE THE MIDDLEWARE (using the app instance you just created)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. THEN DEFINE YOUR ROUTES
class ChatRequest(BaseModel):
    message: str

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    response, _ = ask_agent(request.message, retrievers)
    return {"response": response}