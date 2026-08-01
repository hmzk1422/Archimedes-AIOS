from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional
import httpx
import uvicorn
import os
from dotenv import load_dotenv

app = FastAPI(title="Unified Customer Service Gateway - Dispatcher Hub")
load_dotenv()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
class ActivepiecesInboundPayload(BaseModel):
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
                print(f"Checking row {row.get('id')} - Extension data: {ext}")
                if not isinstance(ext, dict):
                    continue

                connection_extension = ext.get("connection-extension") or {}
                if not connection_extension.get("enabled"):
                    print("Skipped: connection-extension not enabled")
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
# 5. Universal Processing Endpoint for Activepieces
# ==========================================
# ==========================================
# 5a. Fetch Activepieces Pieces Catalog
# ==========================================
@app.get("/activepieces/pieces")
async def get_activepieces_pieces():
    """Fetch all available pieces from Activepieces installation."""
    try:
        # Activepieces internal API endpoint
        activepieces_url = os.getenv("ACTIVEPIECES_URL", "http://localhost:3001")
        
        async with httpx.AsyncClient() as client:
            # Try to fetch pieces from Activepieces API
            response = await client.get(
                f"{activepieces_url}/api/v1/pieces",
                headers={"Content-Type": "application/json"},
                timeout=10.0
            )
            
            if response.status_code == 200:
                pieces = response.json()
                return {"status": "ok", "pieces": pieces}
            else:
                # Fallback: return curated list of common Activepieces pieces
                return {
                    "status": "ok",
                    "pieces": get_fallback_activepieces_pieces(),
                    "note": "Using fallback catalog - Activepieces API not reachable"
                }
    except Exception as e:
        print(f"[WARNING] Could not fetch Activepieces pieces: {e}")
        return {
            "status": "ok",
            "pieces": get_fallback_activepieces_pieces(),
            "note": f"Using fallback catalog - {str(e)}"
        }


def get_fallback_activepieces_pieces():
    """Fallback catalog of common Activepieces pieces if API is not available."""
    return [
        # Triggers
        {"name": "Telegram Trigger", "type": "telegram", "category": "trigger", "icon": "✈️", "color": "#229ED9"},
        {"name": "WhatsApp Trigger", "type": "whatsapp", "category": "trigger", "icon": "💬", "color": "#25D366"},
        {"name": "Webhook Trigger", "type": "webhook", "category": "trigger", "icon": "🔗", "color": "#8B5CF6"},
        {"name": "Email Trigger", "type": "email_trigger", "category": "trigger", "icon": "📧", "color": "#EA580C"},
        {"name": "Schedule Trigger", "type": "schedule", "category": "trigger", "icon": "⏰", "color": "#F59E0B"},
        {"name": "HTTP Request Trigger", "type": "http_trigger", "category": "trigger", "icon": "🌐", "color": "#3B82F6"},
        {"name": "Slack Trigger", "type": "slack_trigger", "category": "trigger", "icon": "💼", "color": "#4A154B"},
        {"name": "Discord Trigger", "type": "discord_trigger", "category": "trigger", "icon": "🎮", "color": "#5865F2"},
        {"name": "GitHub Trigger", "type": "github_trigger", "category": "trigger", "icon": "🐙", "color": "#181717"},
        {"name": "Stripe Trigger", "type": "stripe_trigger", "category": "trigger", "icon": "💳", "color": "#635BFF"},
        
        # AI & Logic
        {"name": "AI Agent", "type": "ai_agent", "category": "ai", "icon": "🤖", "color": "#EAB308"},
        {"name": "HITL Gate", "type": "hitl_gate", "category": "ai", "icon": "👤", "color": "#EF4444"},
        {"name": "Transform", "type": "transform", "category": "logic", "icon": "🔄", "color": "#A855F7"},
        {"name": "Condition", "type": "condition", "category": "logic", "icon": "🔀", "color": "#06B6D4"},
        {"name": "Code", "type": "code", "category": "logic", "icon": "💻", "color": "#6366F1"},
        {"name": "Loop", "type": "loop", "category": "logic", "icon": "🔁", "color": "#EC4899"},
        {"name": "Delay", "type": "delay", "category": "logic", "icon": "⏱️", "color": "#6B7280"},
        {"name": "Router", "type": "router", "category": "logic", "icon": "🔀", "color": "#F97316"},
        
        # Actions
        {"name": "Send Email", "type": "send_email", "category": "action", "icon": "📧", "color": "#EA580C"},
        {"name": "HTTP Request", "type": "http_request", "category": "action", "icon": "📡", "color": "#6366F1"},
        {"name": "Database", "type": "database", "category": "action", "icon": "🗄️", "color": "#3ECF8E"},
        {"name": "Slack Send", "type": "slack_send", "category": "action", "icon": "💼", "color": "#4A154B"},
        {"name": "Telegram Send", "type": "telegram_send", "category": "action", "icon": "✈️", "color": "#229ED9"},
        {"name": "WhatsApp Send", "type": "whatsapp_send", "category": "action", "icon": "💬", "color": "#25D366"},
        {"name": "Discord Send", "type": "discord_send", "category": "action", "icon": "🎮", "color": "#5865F2"},
        {"name": "GitHub Action", "type": "github_action", "category": "action", "icon": "🐙", "color": "#181717"},
        {"name": "Stripe Action", "type": "stripe_action", "category": "action", "icon": "💳", "color": "#635BFF"},
        {"name": "Google Sheets", "type": "google_sheets", "category": "action", "icon": "📊", "color": "#34A853"},
        {"name": "Notion", "type": "notion", "category": "action", "icon": "📝", "color": "#000000"},
        {"name": "Airtable", "type": "airtable", "category": "action", "icon": "📋", "color": "#18BFFF"},
        {"name": "Supabase", "type": "supabase", "category": "action", "icon": "🗄️", "color": "#3ECF8E"},
        {"name": "PostgreSQL", "type": "postgresql", "category": "action", "icon": "🐘", "color": "#4169E1"},
        {"name": "MySQL", "type": "mysql", "category": "action", "icon": "🐬", "color": "#4479A7"},
        {"name": "Redis", "type": "redis", "category": "action", "icon": "🔴", "color": "#DC382D"},
        {"name": "AWS S3", "type": "aws_s3", "category": "action", "icon": "☁️", "color": "#FF9900"},
        {"name": "Twilio", "type": "twilio", "category": "action", "icon": "📞", "color": "#F22F46"},
        {"name": "SendGrid", "type": "sendgrid", "category": "action", "icon": "📧", "color": "#1A82F2"},
        {"name": "Mailgun", "type": "mailgun", "category": "action", "icon": "📮", "color": "#FF6B35"},
        {"name": "Zendesk", "type": "zendesk", "category": "action", "icon": "🏢", "color": "#03363D"},
        {"name": "Intercom", "type": "intercom", "category": "action", "icon": "💬", "color": "#1F8DED"},
        {"name": "HubSpot", "type": "hubspot", "category": "action", "icon": "🎯", "color": "#FF7A59"},
        {"name": "Salesforce", "type": "salesforce", "category": "action", "icon": "☁️", "color": "#00A1E0"},
        {"name": "Shopify", "type": "shopify", "category": "action", "icon": "🛍️", "color": "#96BF48"},
        {"name": "WordPress", "type": "wordpress", "category": "action", "icon": "📝", "color": "#21759B"},
        {"name": "FTP", "type": "ftp", "category": "action", "icon": "📁", "color": "#FF6B35"},
        {"name": "SFTP", "type": "sftp", "category": "action", "icon": "🔒", "color": "#00D4AA"},
        {"name": "Google Drive", "type": "google_drive", "category": "action", "icon": "📁", "color": "#4285F4"},
        {"name": "Dropbox", "type": "dropbox", "category": "action", "icon": "📦", "color": "#0061FF"},
        {"name": "OneDrive", "type": "onedrive", "category": "action", "icon": "☁️", "color": "#0078D4"},
    ]


@app.post("/activepieces/process", response_model=DispatcherResponse)
async def process_activepieces_message(payload: ActivepiecesInboundPayload):
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

    print(f"[SUCCESS] AI responded for tenant {tenant_match.tenant_id}. Returning to Activepieces.")
    return DispatcherResponse(
        status="success",
        reply_text=ai_response_text,
        tenant_id=tenant_match.tenant_id,
        token=payload.token,
        platform=platform,
        customer_id=cust_id,
        outbound=tenant_match.platform_config,
    )


# ==========================================
# 6. Universal Processing Endpoint for n8n
# ==========================================
@app.post("/n8n/process")
async def process_n8n_message(request: dict):
    """
    n8n sends normalized payloads directly (not wrapped in ActivepiecesInboundPayload).
    Expected format: { platform, token, message, customer_id }
    """
    try:
        platform = str(request.get("platform", "")).lower().strip()
        token = str(request.get("token", "")).strip()
        message = request.get("message", {})
        customer_id = request.get("customer_id", "")

        print(f"[INFO] Received n8n {platform} message from customer {customer_id}")

        if not platform or not token:
            raise HTTPException(status_code=400, detail="Missing platform or token")

        # Extract message text and customer ID using the same logic as activepieces
        msg_text = extract_message_text(platform, message)
        cust_id = extract_customer_id(platform, message, customer_id)

        if not msg_text:
            raise HTTPException(status_code=400, detail="No message text found in payload")

        # Look up tenant
        tenant_match = await get_tenant_by_token(platform, token)
        if not tenant_match:
            print(f"[WARNING] Disabled or unregistered token for {platform}: {token}")
            raise HTTPException(status_code=404, detail="Tenant not found for this enabled platform token")

        # Send to AI engine
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
        
        # Return the same structure as activepieces for consistency
        return {
            "status": "success",
            "reply_text": ai_response_text,
            "tenant_id": tenant_match.tenant_id,
            "token": token,
            "platform": platform,
            "customer_id": cust_id,
            "outbound": tenant_match.platform_config,
        }
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] n8n processing failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# ==========================================
# 7. Direct Telegram Webhook Endpoint
# ==========================================
@app.post("/webhook/{webhook_id}/gateway/telegram/{token}")
async def telegram_webhook_handler(webhook_id: str, token: str, request: dict):
    """
    Direct Telegram webhook handler for when n8n is not running.
    Telegram sends updates directly to this endpoint via ngrok.
    Path matches n8n webhook pattern: /webhook/{webhook_id}/gateway/telegram/{token}
    """
    try:
        print(f"[INFO] Received Telegram webhook (webhook_id={webhook_id})")
        
        # Extract message from Telegram update
        message = request.get("message") or request.get("edited_message") or {}
        msg_text = extract_message_text("telegram", message)
        customer_id = extract_customer_id("telegram", message, None)
        
        if not msg_text:
            print("[INFO] No message text in Telegram update, ignoring")
            return {"status": "ok", "message": "No message text"}
        
        print(f"[INFO] Telegram message from {customer_id}: {msg_text[:50]}...")
        
        # Look up tenant by token
        tenant_match = await get_tenant_by_token("telegram", token)
        if not tenant_match:
            print(f"[WARNING] Invalid telegram token: {token}")
            raise HTTPException(status_code=404, detail="Invalid token")
        
        # Send to AI engine
        ai_request_body = {
            "message": msg_text,
            "tenant_id": tenant_match.tenant_id,
            "customer_id": customer_id,
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
        
        # Send reply back to Telegram
        bot_token = os.getenv("TELEGRAM_TOKEN", token)
        chat_id = customer_id
        
        telegram_api_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        telegram_payload = {
            "chat_id": chat_id,
            "text": ai_response_text,
            "parse_mode": "HTML",
        }
        
        async with httpx.AsyncClient() as client:
            try:
                telegram_response = await client.post(telegram_api_url, json=telegram_payload, timeout=10.0)
                telegram_response.raise_for_status()
                print(f"[SUCCESS] Replied to Telegram user {customer_id}")
            except Exception as exc:
                print(f"[ERROR] Failed to send Telegram reply: {exc}")
                # Don't fail the whole request if reply fails
        
        return {
            "status": "success",
            "reply_text": ai_response_text,
            "tenant_id": tenant_match.tenant_id,
            "platform": "telegram",
            "customer_id": customer_id,
        }
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] Telegram webhook processing failed: {exc}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("extension:app", host="0.0.0.0", port=8001, reload=True)