import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from gemini import ask_agent, get_retrievers_for_tenant, preprocess

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
    tenant_id: str | None = None


class IngestRequest(BaseModel):
    tenant_id: str
    datatype: str | None = "policies"

from fastapi import BackgroundTasks

@app.post("/ingest")
async def ingest_endpoint(request: IngestRequest, background_tasks: BackgroundTasks):
    """Trigger preprocessing in the background."""
    try:
        # Pass the heavy lifting to a background thread
        background_tasks.add_task(
            preprocess, 
            tenant_id=request.tenant_id, 
            datatype_label=request.datatype
        )
        # Immediately return success to the client/n8n
        return {"status": "ok", "message": "Ingestion started in the background"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    
@app.post("/chat")
async def chat_endpoint(data: dict):
    user_input = data.get("message")
    tenant_id = data.get("tenant_id")
    
    # 1. Get your retrievers (you already have this logic)
    retrievers = { "policies": preprocess(tenant_id, "policies") } 
    
    # 2. Call your Brain
    response_text, context = ask_agent(user_input, retrievers, tenant_id)
    
    # 3. Return to the Traffic Controller
    return {"response": response_text}

"""
async def chat_endpoint(request: ChatRequest):
    # Create retrievers scoped to the requesting tenant so that newly uploaded
    # files are associated with the correct user id and datatype folder.
    retrievers = get_retrievers_for_tenant(request.tenant_id)
    response, _ = ask_agent(request.message, retrievers, tenant_id=request.tenant_id)
    return {"response": response}
"""

@app.get("/storage-list")
async def storage_list(tenant_id: str | None = None):
    """Debug endpoint: return the list of object names under the tenant root."""
    bucket = os.getenv("SUPABASE_BUCKET", "customer-service-provider")
    tenant_scope = (tenant_id or "").strip("/")
    try:
        items = preprocess.__globals__["supabase"].storage.from_(bucket).list(path=tenant_scope)
        # Return simplified list of names
        names = [i.get("name") for i in (items or [])]
        return {"status": "ok", "items": names}
    except Exception as e:
        return {"status": "error", "message": str(e)}