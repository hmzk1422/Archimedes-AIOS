"""
Workflow Engine — makes the in-house drag-and-drop canvas actually EXECUTE.

Reads a tenant's saved flow from `profiles.extension['connection-extension'].flow`
(the format the canvas writes), finds the first enabled AI Agent node, runs it
through the real ask_agent pipeline (scoped to that node's `mode` and `system_prompt`),
then executes downstream output nodes (telegram_send, database, etc.) by following the
edge graph. This turns a drawn flow into a running agent.

Returns the same shape as ask_agent plus an `actions` list describing outputs executed.
"""
import os
import json  # noqa: F401  (kept for parity with sibling modules)
import requests

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPADB_API")

_ask_agent = None
_get_retrievers = None


def _import_gemini():
    global _ask_agent, _get_retrievers
    if _ask_agent is None:
        from gemini import ask_agent, get_retrievers_for_tenant

        _ask_agent = ask_agent
        _get_retrievers = get_retrievers_for_tenant
    return _ask_agent, _get_retrievers


def get_tenant_flow(tenant_id: str):
    """Return (nodes, edges, enabled) for the tenant's saved canvas flow."""
    base_url = SUPABASE_URL or os.getenv("SUPABASE_URL")
    base_key = SUPABASE_KEY or os.getenv("SUPADB_API")
    if not base_url or not base_key:
        return {}, [], False
    headers = {
        "apikey": base_key,
        "Authorization": f"Bearer {base_key}",
    }
    try:
        resp = requests.get(
            f"{base_url}/rest/v1/profiles?id=eq.{tenant_id}&select=extension&limit=1",
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            return {}, [], False
        rows = resp.json() or []
        if not rows:
            return {}, [], False
        ext = rows[0].get("extension") or {}
        if not isinstance(ext, dict):
            ext = {}
        conn = ext.get("connection-extension") or ext
        if not isinstance(conn, dict):
            conn = {}
        flow = conn.get("flow") or {}
        if not isinstance(flow, dict):
            flow = {}
        nodes = flow.get("nodes") or {}
        edges = flow.get("edges") or []
        enabled = bool(flow.get("masterEnabled", conn.get("enabled", True)))
        return nodes, edges, enabled
    except Exception:
        return {}, [], False


def _find_ai_node(nodes):
    for node_id, node in (nodes or {}).items():
        if not isinstance(node, dict):
            continue
        if node.get("typeId") != "ai-agent":
            continue
        if node.get("enabled") is False:
            continue
        return node_id, node
    return None, None


def _run_outputs(nodes, edges, ai_node_id, tenant_id, result):
    """Execute output nodes connected to the AI Agent node's ports (best-effort)."""
    actions = []
    hitl_pending = bool(result.get("hitl_pending"))
    response_text = str(result.get("response", ""))

    for edge in edges or []:
        if not isinstance(edge, dict):
            continue
        if edge.get("source") != ai_node_id:
            continue
        source_handle = edge.get("sourceHandle") or "out-response"
        target = nodes.get(edge.get("target")) if isinstance(nodes, dict) else None
        if not target or not isinstance(target, dict):
            continue
        if target.get("enabled") is False:
            continue
        # Only traverse the hitl output when a decision is pending, and vice-versa.
        if source_handle == "out-hitl" and not hitl_pending:
            continue
        if source_handle in ("out-response", "") and hitl_pending:
            continue
        action = _execute_output_node(target, tenant_id, response_text)
        if action:
            actions.append(action)
    return actions


def _execute_output_node(node, tenant_id, response_text):
    type_id = node.get("typeId")
    config = node.get("config") or {}
    base_url = SUPABASE_URL or os.getenv("SUPABASE_URL")
    base_key = SUPABASE_KEY or os.getenv("SUPADB_API")
    try:
        if type_id == "telegram_send":
            token = config.get("telegram_token") or os.getenv("TELEGRAM_TOKEN")
            chat_id = config.get("chat_id") or tenant_id
            if not token or not str(token).strip() or str(token).startswith("http"):
                return {"node": type_id, "skipped": "telegram token is a placeholder"}
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            r = requests.post(
                url,
                json={"chat_id": chat_id, "text": response_text, "parse_mode": "HTML"},
                timeout=10,
            )
            return {"node": type_id, "status_code": r.status_code}
        if type_id == "database":
            table = config.get("table_name") or "conversations"
            if base_url and base_key:
                headers = {
                    "apikey": base_key,
                    "Authorization": f"Bearer {base_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                }
                r = requests.post(
                    f"{base_url}/rest/v1/{table}",
                    json={"tenant_id": tenant_id, "response": response_text},
                    headers=headers,
                    timeout=10,
                )
                return {"node": type_id, "table": table, "status_code": r.status_code}
            return {"node": type_id, "skipped": "no db configured"}
        if type_id == "email":
            return {"node": type_id, "to": config.get("to"), "skipped": "smtp not configured"}
        if type_id == "http-response":
            return {"node": type_id, "status_code": config.get("status_code", "200")}
        return {"node": type_id, "handled": False}
    except Exception as exc:  # output nodes are best-effort and must not crash the flow
        return {"node": type_id, "error": str(exc)}


def run_flow(tenant_id, message, customer_id=None, mode_hint=None, system_prompt_hint=None, flow=None):
    """
    Execute the tenant's saved canvas flow for one inbound message.

    - Loads the flow. If it's disabled or has no AI Agent node, falls back to a
      normal ask_agent call (mode from mode_hint / tenant active mode).
    - Otherwise runs the AI Agent node with its mode + system_prompt, then executes
      output nodes connected to it.
    - `flow`, when provided (the canvas' live config), is used directly instead of
      reloading the saved flow — so the editor's Run button runs exactly what's drawn.
    """
    if flow and isinstance(flow, dict) and flow.get("nodes"):
        nodes, edges = flow.get("nodes") or {}, flow.get("edges") or []
        enabled = bool(flow.get("masterEnabled", True))
    else:
        nodes, edges, enabled = get_tenant_flow(tenant_id)
    ai_node_id, ai_node = _find_ai_node(nodes)

    ask_agent, get_retrievers = _import_gemini()

    mode = mode_hint
    system_prompt = system_prompt_hint
    if ai_node:
        cfg = ai_node.get("config") or {}
        mode = cfg.get("mode") or mode
        system_prompt = cfg.get("system_prompt") or system_prompt

    retrievers = get_retrievers(tenant_id, mode=mode)
    result = ask_agent(
        message,
        retrievers,
        tenant_id,
        customer_id,
        mode=mode,
        system_prompt=system_prompt,
    )
        result = dict(result or {})

    if ai_node_id and enabled:
        result["flow_node"] = ai_node["typeId"]
        result["actions"] = _run_outputs(nodes, edges, ai_node_id, tenant_id, result)
    else:
        result["flow_node"] = None
        result["actions"] = []

    return result

