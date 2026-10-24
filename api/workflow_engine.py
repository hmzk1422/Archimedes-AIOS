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
import re
import json  # noqa: F401  (kept for parity with sibling modules)
import time
import uuid
import requests
import smtplib
from email.message import EmailMessage

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
    """Execute the downstream graph from the AI Agent node (best-effort BFS).

    Previously only the AI Agent's direct successors were executed, so a drawn
    flow like `ai-agent -> delay -> http_request` would silently drop the nodes
    after the first hop. We now walk the edge graph so every connected node in
    the response branch runs. The hitl gating on the AI Agent's own outputs is
    preserved exactly (out-hitl only when a decision is pending).
    """
    actions = []
    hitl_pending = bool(result.get("hitl_pending"))
    response_text = str(result.get("response", ""))

    # Build adjacency: source node id -> outgoing edges.
    adj = {}
    for edge in edges or []:
        if isinstance(edge, dict):
            adj.setdefault(edge.get("source"), []).append(edge)

    # Seed the BFS with the AI Agent's downstream edges, applying the same
    # hitl gating the canvas uses.
    queue = []
    for edge in adj.get(ai_node_id, []):
        source_handle = edge.get("sourceHandle") or "out-response"
        if source_handle == "out-hitl" and not hitl_pending:
            continue
        if source_handle in ("out-response", "") and hitl_pending:
            continue
        queue.append(edge.get("target"))

    visited = set()
    idx = 0
    while idx < len(queue):
        nid = queue[idx]
        idx += 1
        if not isinstance(nodes, dict) or nid not in nodes:
            continue
        if nid in visited:
            continue
        node = nodes.get(nid)
        if not node or not isinstance(node, dict):
            continue
        if node.get("enabled") is False:
            continue
        visited.add(nid)

        action = _execute_output_node(node, tenant_id, response_text, context=result)
        if action:
            actions.append(action)

        # Follow this node's downstream edges so chains execute end to end.
        for edge in adj.get(nid, []):
            tgt = edge.get("target")
            if tgt and tgt not in visited:
                queue.append(tgt)

    return actions


def _send_email(node, response_text):
    """Actually send an email via SMTP using api/.env SMTP_* vars.

    Both the canvas 'email' and 'send_email' node types route here. e.g.
    SMTP_HOST=smtp.gmail.com / SMTP_USER / SMTP_PASS / SMTP_FROM.
    """
    config = node.get("config") or {}
    to = (config.get("to") or "").strip()
    subject = (config.get("subject_template") or "Your AI assistant has a response").strip()

    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    from_addr = os.getenv("SMTP_FROM") or user

    if not to:
        return {"node": node.get("typeId"), "error": "email send skipped: no 'to' recipient configured"}
    if not host or not user or not password:
        return {"node": node.get("typeId"), "to": to, "skipped": "smtp not configured (missing SMTP_HOST/USER/PASS)"}

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(response_text or "(no response text)")

    with smtplib.SMTP(host, port, timeout=15) as server:
        server.ehlo()
        if port == 587:
            server.starttls()
        server.login(user, password)
        server.send_message(msg)
    return {"node": node.get("typeId"), "to": to, "status": "sent"}


def _to_float(value):
    """Best-effort numeric coercion for node config values (always strings)."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _resolve_template(template, scope, fallback=""):
    """Resolve ``{{ a.b.c }}`` tokens against `scope`.

    Root variables:
      - ``response`` -> the AI node result dict (so ``{{response.duration_ms}}`` works)
      - ``value``    -> the AI response text
      - ``tenant``   -> the tenant id
    Unknown tokens collapse to an empty string, so a missing field never crashes a flow.
    """
    if not isinstance(template, str) or not template:
        return fallback
    pattern = re.compile(r"\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}")

    def _walk(root, segments):
        cur = root
        for seg in segments:
            if isinstance(cur, dict) and seg in cur:
                cur = cur[seg]
            else:
                return None
        return cur

    def _replace(match):
        val = _walk(scope, match.group(1).split("."))
        if val is None:
            return ""
        if isinstance(val, bool):
            return "true" if val else "false"
        return str(val)

    return pattern.sub(_replace, template)


def _record_metric(tenant_id, record):
    """Persist a metrics-node record to Supabase as datatype=telemetry_metrics.

    Best-effort: silently no-ops when the DB isn't configured so flows keep
    running. Kept dependency-free (raw requests, no opentelemetry) so the engine
    stays hermetic-testable and import-light.
    """
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    key = SUPABASE_KEY or os.getenv("SUPADB_API")
    if not rest_url or not key:
        return None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = {
        "tenant_id": tenant_id,
        "datatype": "telemetry_metrics",
        "filename": record.get("metric_name") or "metrics",
        "data": record,
    }
    try:
        return requests.post(rest_url, json=body, headers=headers, timeout=5)
    except Exception:
        return None


def _execute_output_node(node, tenant_id, response_text, context=None):
    """Execute a single output-node.

    `context` is the AI Agent's full result dict, which lets value templates
    resolve structured fields (e.g. {{response.duration_ms}}).
    """
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
        if type_id in ("email", "send_email"):
            return _send_email(node, response_text)
        if type_id == "http-response":
            return {"node": type_id, "status_code": config.get("status_code", "200")}
        if type_id == "delay":
            mode = config.get("delay_mode") or "fixed_seconds"
            try:
                secs = int(float(config.get("delay_seconds") or 0))
            except (TypeError, ValueError):
                secs = 0
            if mode == "until_time":
                return {
                    "node": type_id,
                    "delay_mode": "until_time",
                    "skipped": "until_time mode has no scheduler to resume delivery in the synchronous run",
                }
            # Never actually sleep here: that would block the request thread.
            # Report the intended delay so it is visible in Run output.
            return {
                "node": type_id,
                "delay_seconds": secs,
                "note": "delay not applied synchronously; a deployed runtime would pause the flow here",
            }
        if type_id == "http_request":
            method = (config.get("method") or "GET").upper()
            url = config.get("url")
            if not url:
                return {"node": type_id, "skipped": "no url configured"}
            headers = {}
            body = None
            try:
                if config.get("headers"):
                    raw_h = config["headers"]
                    headers = json.loads(raw_h) if isinstance(raw_h, str) else dict(raw_h)
                if config.get("body"):
                    raw_b = config["body"]
                    body = json.loads(raw_b) if isinstance(raw_b, str) else raw_b
            except (ValueError, TypeError) as exc:
                return {"node": type_id, "error": f"invalid config json: {exc}"}
            try:
                r = requests.request(method, url, json=body, headers=headers, timeout=10)
                return {"node": type_id, "status_code": r.status_code}
            except Exception as exc:
                return {"node": type_id, "error": f"request failed: {exc}"}
        if type_id == "loop":
            raw = config.get("collection") or "[]"
            try:
                items = json.loads(raw) if isinstance(raw, str) else raw
            except (ValueError, TypeError) as exc:
                return {"node": type_id, "error": f"invalid collection json: {exc}"}
            if not isinstance(items, list):
                items = [items]
            try:
                max_it = int(config.get("max_iterations") or 100)
            except (TypeError, ValueError):
                max_it = 100
            return {
                "node": type_id,
                "iterations": min(len(items), max_it),
                "item_var": config.get("item_var") or "item",
            }
        if type_id == "router":
            raw = config.get("routes") or "[]"
            try:
                routes = json.loads(raw) if isinstance(raw, str) else raw
            except (ValueError, TypeError):
                routes = []
            return {
                "node": type_id,
                "routed_to": config.get("default_route") or "default",
                "routes": routes,
            }
        if type_id == "metrics":
            metric_name = (config.get("metric_name") or config.get("metricName") or "").strip()
            if not metric_name:
                return {"node": type_id, "skipped": "no metric_name configured"}
            metric_type = config.get("metric_type") or "counter"
            value_template = config.get("value_template") or config.get("value_expression")

            scope = {"response": context or {}, "value": response_text, "tenant": tenant_id}
            value = None
            if value_template:
                value = _resolve_template(value_template, scope, "")
            if value is None and config.get("value") is not None:
                value = config.get("value")

            numeric_value = _to_float(value)

            tags = config.get("tags")
            if isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except (ValueError, TypeError):
                    tags = {}
            tags = tags if isinstance(tags, dict) else {}

            record = {
                "metric_name": metric_name,
                "metric_type": metric_type,
                "value": numeric_value if numeric_value is not None else value,
                "value_expression": value_template,
                "tags": tags,
                "evaluation_name": config.get("evaluation_name"),
                "score_min": _to_float(config.get("score_min")),
                "score_max": _to_float(config.get("score_max")),
                "unit": config.get("unit"),
                "run_id": config.get("run_id") or f"{tenant_id}:{uuid.uuid4().hex}",
                "node_id": node.get("id") or node.get("nodeId"),
                "bot_id": config.get("bot_id"),
                "ts": time.time_ns(),
            }
            _record_metric(tenant_id, record)
            return {
                "node": type_id,
                "recorded": True,
                "metric_name": metric_name,
                "value": record["value"],
                "metric_type": metric_type,
                "run_id": record["run_id"],
            }
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

