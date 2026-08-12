"""Rigorous runtime test for /activepieces/process (and /n8n/process).

This exercises the REAL endpoint handler code end-to-end. Only the two external
dependencies are mocked:
  1. get_tenant_by_token  -> returns a tenant match (otherwise the handler would
                             need a live Supabase profile with a matching token)
  2. httpx outbound POST   -> the AI engine call (otherwise it would need a real
                             /chat + Gemini)

Everything in between -- payload validation, message/customer extraction,
tenant lookup, request forwarding, and the DispatcherResponse -- is the real code.
"""
import os
import sys

os.environ["AI_ENDPOINT_URL"] = "http://127.0.0.1:9/chat"  # won't be hit (mocked)

HERE = os.path.dirname(os.path.abspath(__file__))
API_DIR = os.path.dirname(HERE)
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

# Import the real FastAPI app + helpers
import extension  # noqa: E402


class FakeResp:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


captured = {}


class FakeAsyncClient:
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, headers=None):  # used by get_tenant_by_token stub? no
        raise NotImplementedError

    async def post(self, url, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return FakeResp({"response": "reply-from-mock-ai"})


async def fake_get_tenant_by_token(platform, token):
    return extension.TenantExtensionMatch(
        tenant_id="tenant-abc",
        platform_config={"telegram_token": token, "some_setting": "x"},
    )


# Patch module-level references used inside the handlers.
extension.httpx.AsyncClient = FakeAsyncClient
extension.get_tenant_by_token = fake_get_tenant_by_token

from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(extension.app)

failures = []

# ---- 1. /activepieces/process: happy path with mode -------------------------
captured.clear()
payload = {
    "platform": "telegram",
    "token": "TEST_TOKEN",
    "message": {"message": {"text": "hello world", "chat": {"id": "777"}}},
    "customer_id": "",
    "mode": "statarb",
}
r = client.post("/activepieces/process", json=payload)
assert r.status_code == 200, f"status {r.status_code}: {r.text}"
data = r.json()
assert data["status"] == "success", data
assert data["reply_text"] == "reply-from-mock-ai", data
assert data["tenant_id"] == "tenant-abc", data
assert data["customer_id"] == "777", data  # extracted from message.chat.id
# The AI engine must have received message + tenant + customer + mode.
assert captured["json"]["message"] == "hello world", captured
assert captured["json"]["tenant_id"] == "tenant-abc", captured
assert captured["json"]["mode"] == "statarb", captured
print("  [ok] /activepieces/process happy path (tenant lookup + forward + mode)")

# ---- 2. /activepieces/process: no mode --------------------------------------
captured.clear()
payload["mode"] = None
r = client.post("/activepieces/process", json=payload)
assert r.status_code == 200, r.text
assert captured["json"].get("mode") is None, captured
print("  [ok] /activepieces/process mode=None passed through as None")

# ---- 3. /activepieces/process: missing message text -> 400 ------------------
r = client.post("/activepieces/process", json={"platform": "telegram", "token": "x", "message": {"message": {}}})
assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
print("  [ok] /activepieces/process empty message -> 400")

# ---- 4. /activepieces/process: tenant lookup returning None -> 404 ----------
extension.get_tenant_by_token = lambda platform, token: None  # async-patched below


async def fake_get_tenant_none(platform, token):
    return None


extension.get_tenant_by_token = fake_get_tenant_none
r = client.post("/activepieces/process", json={"platform": "telegram", "token": "bad", "message": {"message": {"text": "hi", "chat": {"id": "1"}}}})
assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"
print("  [ok] /activepieces/process unknown token -> 404 (auth gate works)")

# restore for n8n test
extension.get_tenant_by_token = fake_get_tenant_by_token

# ---- 5. /n8n/process: forwards mode -----------------------------------------
captured.clear()
r = client.post("/n8n/process", json={
    "platform": "telegram",
    "token": "TEST_TOKEN",
    "message": {"text": "n8n message", "chat": {"id": "555"}},
    "mode": "investment",
})
assert r.status_code == 200, r.text
assert captured["json"]["mode"] == "investment", captured
assert captured["json"]["message"] == "n8n message", captured
print("  [ok] /n8n/process forwards mode + message")

if failures:
    print("\nFAILED")
    for f in failures:
        print(" -", f)
    sys.exit(1)

print("\nALL ACTIVEPIECES RUNTIME TESTS PASSED")
