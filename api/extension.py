from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional
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

TOKEN_FIELD_BY_PLATFORM = {
    "telegram": "telegram_token",
    "whatsapp": "whatsapp_token",
    "zendesk": "zendesk_token",
}

# ==========================================
# 2. Schemas
# ==========================================
class N8nInboundPayload(BaseModel):
    platform: str
    token: str
    message: Any = Field(default_factory=dict)
    customer_id: Optional[str] = ""

    class Config:
        extra = "allow"


class TenantExtensionMatch(BaseModel):
    tenant_id: str
    platform_config: Dict[str, Any] = Field(default_factory=dict)


class DispatcherResponse(BaseModel):
    status: str
    reply_text: str
    tenant_id: str
    token: str
    platform: str
    customer_id: str
    outbound: Dict[str, Any] = Field(default_factory=dict)


# ==========================================
# 3. Payload Normalization
# ==========================================
def _first_non_empty(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)):
            return str(value)
    return ""


def _dig(data: Any, *path: Any) -> Any:
    current = data
    for key in path:
        if isinstance(key, int):
            if not isinstance(current, list) or len(current) <= key:
                return None
            current = current[key]
        else:
            if not isinstance(current, dict):
                return None
            current = current.get(key)
    return current


def extract_message_text(platform: str, message: Any) -> str:
    if isinstance(message, str):
        return message.strip()

    if not isinstance(message, dict):
        return ""

    platform = platform.lower().strip()

    if platform == "telegram":
        return _first_non_empty(
            message.get("text"),
            message.get("caption"),
            _dig(message, "message", "text"),
            _dig(message, "message", "caption"),
        )

    if platform == "whatsapp":
        whatsapp_message = _dig(message, "entry", 0, "changes", 0, "value", "messages", 0) or message
        return _first_non_empty(
            _dig(whatsapp_message, "text", "body"),
            _dig(whatsapp_message, "button", "text"),
            _dig(whatsapp_message, "interactive", "button_reply", "title"),
            _dig(whatsapp_message, "interactive", "list_reply", "title"),
            whatsapp_message.get("body") if isinstance(whatsapp_message, dict) else None,
            message.get("text"),
        )

    if platform == "zendesk":
        return _first_non_empty(
            _dig(message, "comment", "body"),
            _dig(message, "comment", "plain_body"),
            _dig(message, "ticket", "description"),
            _dig(message, "ticket", "latest_comment"),
            message.get("message"),
            message.get("text"),
            message.get("body"),
        )

    return _first_non_empty(message.get("text"), message.get("message"), message.get("body"))


def extract_customer_id(platform: str, message: Any, fallback_customer_id: Optional[str]) -> str:
    if fallback_customer_id:
        return str(fallback_customer_id)

    if not isinstance(message, dict):
        return ""

    platform = platform.lower().strip()

    if platform == "telegram":
        return _first_non_empty(
            _dig(message, "chat", "id"),
            _dig(message, "from", "id"),
            _dig(message, "message", "chat", "id"),
            _dig(message, "message", "from", "id"),
        )

    if platform == "whatsapp":
        whatsapp_message = _dig(message, "entry", 0, "changes", 0, "value", "messages", 0) or message
        return _first_non_empty(
            whatsapp_message.get("from") if isinstance(whatsapp_message, dict) else None,
            _dig(message, "entry", 0, "changes", 0, "value", "contacts", 0, "wa_id"),
            _dig(message, "contact", "wa_id"),
            message.get("from"),
        )

    if platform == "zendesk":
        return _first_non_empty(
            _dig(message, "ticket", "id"),
            message.get("ticket_id"),
            _dig(message, "requester", "id"),
            _dig(message, "user", "id"),
        )

    return _first_non_empty(message.get("customer_id"), message.get("from"), message.get("id"))


# ==========================================
# 4. Database Lookup Layer
# ==========================================
async def get_tenant_by_token(platform: str, target_token: str) -> Optional[TenantExtensionMatch]:
    """Find the tenant profile whose enabled platform config owns this gateway token."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }

    platform_key = platform.lower().strip()
    token_key = TOKEN_FIELD_BY_PLATFORM.get(platform_key, f"{platform_key}_token")
    query_url = f"{SUPABASE_URL}/rest/v1/profiles?select=id,extension"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(query_url, headers=headers)
            response.raise_for_status()
            rows = response.json()

            for row in rows:
                ext = row.get("extension") or {}
                if not isinstance(ext, dict):
                    continue

                connection_extension = ext.get("connection-extension") or {}
                if not connection_extension.get("enabled"):
                    continue

                platforms_config = connection_extension.get("platforms") or {}
                platform_data = platforms_config.get(platform_key) or {}
                if not platform_data.get("enabled"):
                    continue

                config = platform_data.get("config") or {}
                db_token = config.get(token_key)

                if db_token and str(db_token).strip() == target_token.strip():
                    return TenantExtensionMatch(
                        tenant_id=row.get("id"),
                        platform_config=config,
                    )

        except Exception as e:
            print(f"[DB ERROR] Registry lookup failed: {e}")

    return None


# ==========================================
# 5. Universal Processing Endpoint for n8n
# ==========================================
@app.post("/n8n/process", response_model=DispatcherResponse)
async def process_n8n_message(payload: N8nInboundPayload):
    platform = payload.platform.lower().strip()
    cust_id = extract_customer_id(platform, payload.message, payload.customer_id)
    msg_text = extract_message_text(platform, payload.message)

    print(f"[INFO] Received {platform} message from customer {cust_id}")

    if not msg_text:
        raise HTTPException(status_code=400, detail="No message text found in payload")

    tenant_match = await get_tenant_by_token(platform, payload.token)
    if not tenant_match:
        print(f"[WARNING] Disabled or unregistered token for {platform}: {payload.token}")
        raise HTTPException(status_code=404, detail="Tenant not found for this enabled platform token")

    ai_request_body = {
        "message": msg_text,
        "tenant_id": tenant_match.tenant_id,
        "customer_id": cust_id,
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

    print(f"[SUCCESS] AI responded for tenant {tenant_match.tenant_id}. Returning to n8n.")
    return DispatcherResponse(
        status="success",
        reply_text=ai_response_text,
        tenant_id=tenant_match.tenant_id,
        token=payload.token,
        platform=platform,
        customer_id=cust_id,
        outbound=tenant_match.platform_config,
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
