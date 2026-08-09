# company_api.py
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import uvicorn
import os
import requests

app = FastAPI(title="Allianz Mock API")

# Where the real AI platform lives (main.py on port 8000)
AI_ENDPOINT_URL = os.getenv("AI_ENDPOINT_URL", "http://localhost:8000/chat")
# The company's AI tenant id. With the workspace model this is the WORKSPACE id
# (shared by the admin + all team members) — the same value main.py scopes to.
# Set COMPANY_TENANT_ID in the env, or type it in the chat GUI. Empty = main
# scans every tenant's docs (slow) — you almost always want a specific tenant id.
DEFAULT_TENANT_ID = os.getenv("COMPANY_TENANT_ID", "")
DEFAULT_CUSTOMER_ID = os.getenv("COMPANY_CUSTOMER_ID", "company-customer")

# --- 1. The "Company Database" ---
MOCK_DATABASE = {
    "claims": {
        "CLM-123": {"status": "Pending", "reason": "Awaiting Police Report"},
        "CLM-999": {"status": "Approved", "reason": "Funds dispatched to bank account"}
    },
    "policies": {
        "POL-001": {"balance": 5000.00}
    }
}

# --- 2. Data Models (For POST requests) ---
class TopUpRequest(BaseModel):
    amount: float

class ClaimRegistration(BaseModel):
    incident_date: str
    has_all_docs: bool

class ChatRequest(BaseModel):
    message: str
    tenant_id: str | None = None
    customer_id: str | None = None

class ApproveRequest(BaseModel):
    message: str | None = None
    tenant_id: str | None = None
    customer_id: str | None = None
    approve: bool = True

# --- 3. The API Endpoints ---
@app.get("/", response_class=HTMLResponse)
def chat_ui():
    """Serve a simple web chat interface that talks to the /chat endpoint."""
    html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Chat</title>
<style>
  * { box-sizing: border-box; font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
  body { margin: 0; display: flex; flex-direction: column; height: 100vh; background: #f4f6fb; }
  header { background: #1f2a44; color: #fff; padding: 14px 20px; font-size: 18px; font-weight: 600; display: flex; flex-direction: column; gap: 10px; }
  header span { color: #8ab4ff; font-size: 13px; font-weight: 400; }
  #ids { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; font-weight: 500; }
  #ids label { display: flex; align-items: center; gap: 6px; color: #c7cde0; }
  #ids input { padding: 6px 10px; border: 1px solid #3a4a6e; border-radius: 8px; background: #0f1730; color: #fff; font-size: 12px; width: 240px; }
  #ids input:focus { outline: none; border-color: #8ab4ff; }
  #messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
  .bubble { max-width: 72%; padding: 10px 14px; border-radius: 14px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .user { align-self: flex-end; background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
  .ai { align-self: flex-start; background: #fff; color: #1f2a44; border: 1px solid #e3e6ef; border-bottom-left-radius: 4px; }
  form { display: flex; gap: 10px; padding: 14px; background: #fff; border-top: 1px solid #e3e6ef; }
  input { flex: 1; padding: 12px 14px; border: 1px solid #d0d5e0; border-radius: 24px; font-size: 15px; outline: none; }
  input:focus { border-color: #2563eb; }
  button { padding: 12px 22px; border: none; border-radius: 24px; background: #2563eb; color: #fff; font-size: 15px; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  .typing { color: #7a8194; font-style: italic; }
</style>
</head>
<body>
  <header>
    <div>&#128172; Chat with the AI <span>(company-api &#8594; /chat)</span></div>
    <div id="ids">
            <label>Tenant ID <input id="tenantId" type="text" placeholder="your workspace id" value="__TENANT_DEFAULT__"></label>
      <label>Customer ID <input id="customerId" type="text" placeholder="customer id" value="__CUSTOMER_DEFAULT__"></label>
    </div>
  </header>
  <div id="messages">
    <div class="bubble ai">Hi! I&#39;m the AI agent. Ask me anything (e.g. about a claim or policy).</div>
  </div>
  <form id="chatForm">
    <input id="input" type="text" placeholder="Type your message..." autocomplete="off" autofocus>
    <button id="sendBtn" type="submit">Send</button>
  </form>
<script>
  const messages = document.getElementById('messages');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  const tenantId = document.getElementById('tenantId');
  const customerId = document.getElementById('customerId');

  function addBubble(text, who) {
    const div = document.createElement('div');
    div.className = 'bubble ' + who;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
function renderReply(bubble, data){
  const reply = data.response || data.message || '(no reply)';
  let html = '<div style="white-space:pre-wrap;">'+esc(reply)+'</div>';
  if(data.tool_executed){
    html += '<div class="muted" style="font-size:12px;color:#7a8194;">\ud83d\udd28 ' + esc(data.tool_executed) + '</div>';
    if(data.tool_output != null){
      html += '<div class="muted" style="font-size:12px;color:#7a8194;">'+esc(String(data.tool_output))+'</div>';
    }
  }
  if(data.hitl_pending){
    const hint = esc(((data.hitl_reason||'')+' '+(data.hitl_action||'')).trim());
    html += '<div class="muted" style="margin-top:8px;">\ud83d\udd10 Human approval required' + (hint.trim()?' ('+hint+')':'') + ':</div>';
    const bar = document.createElement('div');
    bar.style.marginTop='8px';
    const approve=document.createElement('button'); approve.textContent='Approve'; approve.style.background='#16a34a';
    approve.onclick=()=>submitApproval(true);
    const deny=document.createElement('button'); deny.textContent='Reject'; deny.style.background='#dc2626';
    deny.onclick=()=>submitApproval(false);
    bar.appendChild(approve); bar.appendChild(deny);
    bubble.innerHTML = html;
    bubble.appendChild(bar);
    return;
  }
  bubble.innerHTML = html;
}
async function submitApproval(decision){
  const typing = addBubble('Sending ' + (decision?'approval':'rejection') + '...', 'ai');
  typing.classList.add('typing');
  try{
    const res = await fetch('/chat/approve',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:'',tenant_id:tenantId.value.trim()||null,customer_id:customerId.value.trim()||null,approve:decision})});
    const data = await res.json();
    renderReply(typing, data);
  }catch(err){ typing.textContent='Error: '+err.message; }
  finally{ typing.classList.remove('typing'); input.focus(); }
}
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addBubble(text, 'user');

    const typing = addBubble('AI is thinking...', 'ai');
    typing.classList.add('typing');
    sendBtn.disabled = true;

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          tenant_id: tenantId.value.trim() || null,
          customer_id: customerId.value.trim() || null
        })
      });
      const data = await res.json();
      typing.classList.remove('typing');
      renderReply(typing, data);
    } catch (err) {
      typing.textContent = 'Error: ' + err.message;
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });
</script>
</body>
</html>"""
    # Inject the default tenant/customer ids into the page
    return html.replace("__TENANT_DEFAULT__", DEFAULT_TENANT_ID).replace(
        "__CUSTOMER_DEFAULT__", DEFAULT_CUSTOMER_ID
    )

@app.get("/api/claims/{claim_id}")
def get_claim(claim_id: str):
    """Simulates a GET request to fetch claim data."""
    claim_id = claim_id.upper()
    if claim_id not in MOCK_DATABASE["claims"]:
        raise HTTPException(status_code=404, detail="Claim ID not found.")
    print(MOCK_DATABASE)    
    return MOCK_DATABASE["claims"][claim_id]

@app.post("/api/policies/{policy_id}/top-up")
def process_top_up(policy_id: str, request: TopUpRequest):
    """Simulates a POST request to add money to a policy."""
    # In a real app, you'd update the database here
    print(MOCK_DATABASE)
    return {"message": f"SUCCESS: Top-up of ${request.amount} initiated for Policy #{policy_id}."}

@app.post("/api/claims/{policy_id}/check/{illness}")
def register_claim(policy_id: str, illness: str, request: ClaimRegistration):
    """Simulates a POST request to register a new claim."""
    print(MOCK_DATABASE)
    return {"message": f"SUCCESS: Claim details registered in the database {policy_id} and {illness}.", "data": request.dict()}

# --- 4. Chat with the AI ---
@app.post("/chat")
def chat_with_ai(request: ChatRequest):
    """
    Chat with the AI engine. Tries the real platform (main.py) first,
    and falls back to a tiny mock reply so this endpoint always works.
    """
    payload = {
        "message": request.message,
        "tenant_id": request.tenant_id or DEFAULT_TENANT_ID or None,
        "customer_id": request.customer_id or DEFAULT_CUSTOMER_ID,
    }
    print(f"[company-api] -> AI {AI_ENDPOINT_URL} | tenant={payload['tenant_id']} | msg={request.message[:60]!r}")
    try:
        # Forward to the real AI agent running on main.py
        resp = requests.post(AI_ENDPOINT_URL, json=payload, timeout=120)
        try:
            data = resp.json()
        except Exception:
            data = {}
        # Surface the AI engine's reply, or its own error message
        reply = (
            data.get("response")
            or data.get("message")
            or data.get("detail")
            or f"AI engine returned HTTP {resp.status_code}"
        )
        print(f"[company-api] <- AI HTTP {resp.status_code} | status={data.get('status')}")
        return {
            "status": "ok" if resp.status_code < 400 else "error",
            "response": str(reply),
            "hitl_pending": bool(data.get("hitl_pending", False)),
            "hitl_action": data.get("hitl_action"),
            "hitl_reason": data.get("hitl_reason"),
            "tool_executed": data.get("tool_executed"),
            "tool_output": data.get("tool_output"),
            "source": "ai-platform",
        }
    except requests.exceptions.ConnectionError as e:
        # main.py isn't running / not reachable -- tell the user the truth
        print(f"[company-api] !! Could not reach AI: {type(e).__name__}")
        return {
            "status": "error",
            "response": (
                f"Could not reach the AI engine (main.py) at {AI_ENDPOINT_URL} \u2014 "
                f"make sure it is running on port 8000. ({type(e).__name__})"
            ),
            "source": "unavailable",
        }
    except Exception as e:
        print(f"[company-api] !! AI engine error: {type(e).__name__}: {e}")
        return {
            "status": "error",
            "response": f"AI engine error: {type(e).__name__}: {e}",
            "source": "unavailable",
        }

# --- 5. Approve / reject a pending HITL tool call ---
@app.post("/chat/approve")
def approve_with_ai(request: ApproveRequest):
    """Forward a human approval/rejection to the AI platform's /chat/approve."""
    base_url = AI_ENDPOINT_URL.rsplit("/chat", 1)[0]
    payload = {
        "message": request.message or "",
        "tenant_id": request.tenant_id or DEFAULT_TENANT_ID or None,
        "customer_id": request.customer_id or DEFAULT_CUSTOMER_ID,
        "approve": bool(request.approve),
    }
    print(f"[company-api] -> APPROVE {base_url}/chat/approve | approve={payload['approve']}")
    try:
        resp = requests.post(f"{base_url}/chat/approve", json=payload, timeout=120)
        try:
            data = resp.json()
        except Exception:
            data = {}
        reply = (
            data.get("response")
            or data.get("message")
            or data.get("detail")
            or f"AI engine returned HTTP {resp.status_code}"
        )
        return {
            "status": "ok" if resp.status_code < 400 else "error",
            "response": str(reply),
            "hitl_pending": bool(data.get("hitl_pending", False)),
            "tool_executed": data.get("tool_executed"),
            "tool_output": data.get("tool_output"),
            "source": "ai-platform",
        }
    except requests.exceptions.ConnectionError as e:
        return {
            "status": "error",
            "response": (
                f"Could not reach the AI engine (main.py) at {base_url} \u2014 "
                f"make sure it is running on port 8000. ({type(e).__name__})"
            ),
            "source": "unavailable",
        }
    except Exception as e:
        return {
            "status": "error",
            "response": f"AI engine error: {type(e).__name__}: {e}",
            "source": "unavailable",
        }

if __name__ == "__main__":
    print("Starting Company API Simulation on port 8002...")
    uvicorn.run(app, host="127.0.0.1", port=8002)
