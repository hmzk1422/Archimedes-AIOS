from fastapi import FastAPI, Request, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import httpx
import uvicorn
import os
from dotenv import load_dotenv

app = FastAPI(title="Unified Customer Service Gateway - Dispatcher Hub")
load_dotenv()

# ==========================================
# 1. Core Infrastructure Config (NO CUSTOMER SECRETS HERE)
# ==========================================
AI_ENDPOINT_URL = os.getenv("AI_ENDPOINT_URL", "http://localhost:8000/chat")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPADB_API")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[CRITICAL] Supabase credentials missing from .env!")

# ==========================================
# 2. Schemas
# ==========================================
class UnifiedMessagePayload(BaseModel):
    platform: str
    customer_id: str
    message: str
    tenant_id: str  # The crucial ID mapped from Supabase (e.g., e5900f75...)
    bot_token: Optional[str] = None # Used for Telegram replies
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)

# ==========================================
# 3. Database Lookup Layer
# ==========================================
import urllib.parse  # <--- Add this import at the top

async def get_tenant_by_telegram_token(target_token: str) -> Optional[str]:
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
                # Updated path traversal based on your new info:
                # extension -> connection-extension -> platforms -> telegram -> config -> telegram_token
                conn_ext = ext.get("connection-extension", {})
                platforms = conn_ext.get("platforms", {})
                tg_config = platforms.get("telegram", {}).get("config", {})
                db_token = tg_config.get("telegram_token")
                
                # Check for match (stripping whitespace to be safe)
                if db_token and str(db_token).strip() == target_token.strip():
                    return row.get("id")
                    
        except Exception as e:
            print(f"[DB ERROR] Registry lookup failed: {e}")
            
    return None
# ==========================================
# 4. Outbound Dispatchers (Dynamic)
# ==========================================
async def send_to_telegram(chat_id: str, text: str, bot_token: str):
    """Pushes a message back using the specific Tenant's Telegram Token."""
    if not bot_token:
        print("[ERROR] No bot token provided for outbound dispatch.")
        return
        
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()

# ==========================================
# 5. Core Processing Engine
# ==========================================
async def process_and_dispatch_message(payload: UnifiedMessagePayload):
    """Fetches AI reply scoped to the tenant, then dispatches it out."""
    
    # Step A: Request response from the AI Engine using the matched tenant_id
    # main.py — include it in the outbound AI request
    ai_request_body = {
        "message": payload.message,
        "tenant_id": payload.tenant_id,
        "customer_id": payload.customer_id,
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(AI_ENDPOINT_URL, json=ai_request_body, timeout=45.0)
            response.raise_for_status() 
            ai_data = response.json()
            ai_response_text = ai_data.get("response", "No response generated.")
        except Exception as exc:
            print(f"[ERROR] Failed to fetch response from AI Engine: {exc}")
            return

    # Step B: Route execution back out to the messaging platform
    try:
        if payload.platform == "telegram" and payload.bot_token:
            await send_to_telegram(payload.customer_id, ai_response_text, payload.bot_token)
            
        print(f"[SUCCESS] Outbound reply dispatched to {payload.platform} for user {payload.customer_id}")
    except Exception as exc:
        print(f"[ERROR] Outbound dispatch failed for {payload.platform}: {exc}")

# ==========================================
# 6. Inbound Webhooks
# ==========================================
@app.post("/webhook/telegram/{bot_token}")
async def telegram_webhook(bot_token: str, request: Request, background_tasks: BackgroundTasks):
    """Webhook for Telegram. Token is in the URL to identify the bot/tenant."""
    try:
        payload = await request.json()
        
        if "message" in payload and "text" in payload["message"]:
            chat_id = str(payload["message"]["chat"]["id"])
            text = payload["message"]["text"]
            
            # 1. Map Token to Tenant ID from Supabase
            tenant_id = await get_tenant_by_telegram_token(bot_token)
            
            if not tenant_id:
                print(f"[WARNING] Webhook received for unregistered token: {bot_token}")
                raise HTTPException(status_code=404, detail="Bot not found in registry")

            print(f"[INFO] Routing Telegram message to Tenant: {tenant_id}")
            
            # 2. Package it up with the Tenant ID attached
            unified_request = UnifiedMessagePayload(
                platform="telegram",
                customer_id=chat_id,
                message=text,
                tenant_id=tenant_id,
                bot_token=bot_token
            )
            
            # Offload processing to background worker
            background_tasks.add_task(process_and_dispatch_message, unified_request)
            
    except Exception as e:
        print(f"[WEBHOOK ERROR] Error parsing Telegram payload: {e}")
        
    return {"status": "ok"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)