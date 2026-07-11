from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import httpx
import uvicorn
import os
from dotenv import load_dotenv

app = FastAPI(title="Unified Customer Service Gateway - Dispatcher Hub")
load_dotenv()

# --- Configuration & Secrets ---
AI_ENDPOINT_URL = os.getenv("AI_ENDPOINT_URL", "http://localhost:8000/chat")

WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN", "your_whatsapp_token_here")
WHATSAPP_PHONE_ID = os.getenv("WHATSAPP_PHONE_ID", "your_phone_id_here")

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")

ZENDESK_SUBDOMAIN = os.getenv("ZENDESK_SUBDOMAIN", "your_subdomain")
ZENDESK_EMAIL = os.getenv("ZENDESK_EMAIL", "admin@yoursite.com")
ZENDESK_TOKEN = os.getenv("ZENDESK_TOKEN", "your_zendesk_api_token")

# --- 1. The Agnostic Schema ---
class UnifiedMessagePayload(BaseModel):
    platform: str                  # e.g., "whatsapp", "telegram", "zendesk"
    customer_id: str               # The unique identifier (phone, chat_id, etc.)
    message: str                   # The actual user query
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)

# --- 2. Platform Output Dispatchers ---

async def send_to_whatsapp(customer_id: str, text: str):
    """Pushes a message back to Meta's WhatsApp API."""
    url = f"https://graph.facebook.com/v21.0/{WHATSAPP_PHONE_ID}/messages"
    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": customer_id,
        "text": {"body": text}
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()

async def send_to_telegram(chat_id: str, text: str):
    """Pushes a message back to Telegram's Bot API."""
    global TELEGRAM_TOKEN 
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()

async def send_to_zendesk(ticket_id: str, text: str):
    """Pushes a comment back to a Zendesk ticket."""
    url = f"https://{ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/{ticket_id}"
    auth = (f"{ZENDESK_EMAIL}/token", ZENDESK_TOKEN)
    payload = {
        "ticket": {
            "comment": {"body": text, "public": True}
        }
    }
    async with httpx.AsyncClient() as client:
        response = await client.put(url, auth=auth, json=payload)
        response.raise_for_status()

# --- 3. The Core Processing Engine ---

async def process_and_dispatch_message(payload: UnifiedMessagePayload):
    """
    Core execution logic: Takes normalized payload, fetches AI reply, 
    and dispatches it back out to the respective platform.
    """
    ai_request_body = {
        "message": payload.message,
        "tenant_id": payload.customer_id  
    }

    # Step A: Request response from the AI Engine
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(AI_ENDPOINT_URL, json=ai_request_body, timeout=30.0)
            response.raise_for_status() 
            ai_data = response.json()
            ai_response_text = ai_data.get("response", "No response generated.")
        except Exception as exc:
            print(f"[ERROR] Failed to fetch response from AI Engine: {exc}")
            return

    # Step B: Route execution back out to the messaging platform
    try:
        if payload.platform == "whatsapp":
            await send_to_whatsapp(payload.customer_id, ai_response_text)
        elif payload.platform == "telegram":
            await send_to_telegram(payload.customer_id, ai_response_text)
        elif payload.platform == "zendesk":
            ticket_id = payload.metadata.get("ticket_id")
            if ticket_id:
                await send_to_zendesk(ticket_id, ai_response_text)
        print(f"[SUCCESS] Outbound reply dispatched to {payload.platform} for user {payload.customer_id}")
    except Exception as exc:
        print(f"[ERROR] Outbound dispatch failed for {payload.platform}: {exc}")

# --- 4. Input Channels (Webhooks & API Gateway) ---

@app.post("/webhook/telegram")
async def telegram_webhook(request: Request, background_tasks: BackgroundTasks):
    """Direct inbound hook for Telegram. Instantly acknowledges receipt to prevent retries."""
    try:
        payload = await request.json()
        if "message" in payload and "text" in payload["message"]:
            chat_id = str(payload["message"]["chat"]["id"])
            text = payload["message"]["text"]
            
            unified_request = UnifiedMessagePayload(
                platform="telegram",
                customer_id=chat_id,
                message=text
            )
            # Offload processing to background worker
            background_tasks.add_task(process_and_dispatch_message, unified_request)
    except Exception as e:
        print(f"[WEBHOOK ERROR] Error parsing Telegram payload: {e}")
        
    return {"status": "ok"}

@app.post("/webhook/whatsapp")
async def whatsapp_webhook(request: Request, background_tasks: BackgroundTasks):
    """Direct inbound hook for WhatsApp. Instantly acknowledges receipt to prevent retries."""
    try:
        payload = await request.json()
        entry = payload["entry"][0]
        changes = entry["changes"][0]["value"]
        
        if "messages" in changes:
            msg = changes["messages"][0]
            if msg["type"] == "text":
                phone_number = msg["from"]
                text = msg["text"]["body"]
                
                unified_request = UnifiedMessagePayload(
                    platform="whatsapp",
                    customer_id=phone_number,
                    message=text
                )
                background_tasks.add_task(process_and_dispatch_message, unified_request)
    except Exception as e:
        print(f"[WEBHOOK ERROR] Error parsing WhatsApp payload: {e}")
        
    return {"status": "ok"}

@app.post("/gateway/message")
async def handle_unified_message(payload: UnifiedMessagePayload, background_tasks: BackgroundTasks):
    """Manual/Direct REST API entry point for testing or custom platform extensions."""
    background_tasks.add_task(process_and_dispatch_message, payload)
    return {
        "status": "accepted",
        "platform": payload.platform,
        "customer_id": payload.customer_id,
        "info": "Processing pipeline initiated in background."
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)