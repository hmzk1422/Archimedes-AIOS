from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import httpx
import uvicorn
import os
from dotenv import load_dotenv

app = FastAPI(title="Unified Customer Service Gateway - Dispatcher Hub")
load_dotenv()

"""
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
"""
# ==========================================
# 1. Core Infrastructure Config
# ==========================================
AI_ENDPOINT_URL = os.getenv("AI_ENDPOINT_URL", "http://localhost:8000/chat")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPADB_API")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[CRITICAL] Supabase credentials missing from .env!")

# ==========================================
# 2. Schemas
# ==========================================
class N8nInboundPayload(BaseModel):
    platform: str
    token: str
    message: dict 
    customer_id: Optional[str] = "" 

    @property
    def real_customer_id(self):
        if self.customer_id:
            return self.customer_id
        return str(self.message.get("chat", {}).get("id", ""))

class DispatcherResponse(BaseModel):
    status: str
    reply_text: str
    tenant_id: str
    token: str          # Added so n8n knows which bot to reply from
    platform: str       # Added for the Switch node
    customer_id: str    # Added so n8n knows which user to message back

# ==========================================
# 3. Database Lookup Layer
# ==========================================
async def get_tenant_by_token(platform: str, target_token: str) -> Optional[str]:
    """Dynamically searches Supabase for a token matching the specific platform."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    
    query_url = f"{SUPABASE_URL}/rest/v1/profiles?select=id,extension"
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(query_url, headers=headers)
            response.raise_for_status()
            rows = response.json()
            
            for row in rows:
                ext = row.get("extension") or {}
                platforms_config = ext.get("connection-extension", {}).get("platforms", {})
                
                # Dynamically traverse based on platform (e.g., telegram, whatsapp)
                platform_data = platforms_config.get(platform, {}).get("config", {})
                db_token = platform_data.get(f"{platform}_token")
                
                if db_token and str(db_token).strip() == target_token.strip():
                    return row.get("id")
                    
        except Exception as e:
            print(f"[DB ERROR] Registry lookup failed: {e}")
            
    return None

# ==========================================
# 4. Universal Processing Endpoint for n8n
# ==========================================
@app.post("/n8n/process", response_model=DispatcherResponse)
async def process_n8n_message(payload: N8nInboundPayload):
    # Use the property we defined to get the real ID
    cust_id = payload.real_customer_id
    msg_text = payload.message.get("text", "")
    
    print(f"[INFO] Received {payload.platform} message from customer {cust_id}")

    # 1. Map Token to Tenant ID
    tenant_id = await get_tenant_by_token(payload.platform, payload.token)
    if not tenant_id:
        print(f"[WARNING] Unregistered token for {payload.platform}: {payload.token}")
        raise HTTPException(status_code=404, detail="Tenant not found for this token")

    # 2. Ask AI Engine
    ai_request_body = {
        "message": msg_text, # Using the extracted string instead of the raw dict
        "tenant_id": tenant_id,
        "customer_id": cust_id, # Using the extracted cust_id
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(AI_ENDPOINT_URL, json=ai_request_body, timeout=45.0)
            response.raise_for_status() 
            ai_data = response.json()
            ai_response_text = ai_data.get("response", "No response generated.")
        except Exception as exc:
            print(f"[ERROR] Failed to fetch response from AI Engine: {exc}")
            raise HTTPException(status_code=500, detail="AI Engine Error")

    # 3. Return string to n8n (so n8n can handle the outbound API dispatch)
    print(f"[SUCCESS] AI responded for tenant {tenant_id}. Returning to n8n.")
    return DispatcherResponse(
        status="success",
        reply_text=ai_response_text,
        tenant_id=tenant_id,
        token=payload.token,
        platform=payload.platform,
        customer_id=cust_id,  # <--- CHANGE THIS FROM payload.customer_id TO cust_id
    )
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)