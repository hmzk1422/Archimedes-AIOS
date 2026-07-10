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


@app.post("/ingest")
async def ingest_endpoint(request: IngestRequest):
    """Trigger preprocessing (LlamaParse and vector insertion) for a tenant and datatype.

    This is useful to run immediately after a user uploads files so that
    the documents are parsed and available for retrieval without waiting
    for a chat request to trigger preprocessing.
    """
    try:
        preprocess(tenant_id=request.tenant_id, datatype_label=request.datatype)
        return {"status": "ok", "message": "Ingestion started/completed"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    # Create retrievers scoped to the requesting tenant so that newly uploaded
    # files are associated with the correct user id and datatype folder.
    retrievers = get_retrievers_for_tenant(request.tenant_id)
    response, _ = ask_agent(request.message, retrievers, tenant_id=request.tenant_id)
    return {"response": response}