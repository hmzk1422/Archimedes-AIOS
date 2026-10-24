"""Unit tests for the canvas workflow engine (api/workflow_engine.py).

These mock the heavy external dependencies (ask_agent + get_retrievers_for_tenant)
so they exercise ONLY the flow-graph wiring logic: mode/system_prompt propagation
to the AI Agent node, output-node execution, hitl routing, and the Run-as-drawn
`flow` override path.
"""
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
API_DIR = os.path.dirname(HERE)
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

import workflow_engine as we  # noqa: E402

# --- Fake external dependencies -----------------------------------------
captured = {}


def fake_get_retrievers(tenant_id, mode=None):
    return {"fake": True}


def make_ask_agent(response="ai-response", hitl_pending=False, extra=None):
    def fake_ask_agent(user_input, retrievers, tenant_id=None, customer_id=None,
                       mode=None, system_prompt=None):
        captured["user_input"] = user_input
        captured["tenant_id"] = tenant_id
        captured["customer_id"] = customer_id
        captured["mode"] = mode
        captured["system_prompt"] = system_prompt
        captured["retrievers"] = retrievers
        result = {"response": response, "hitl_pending": hitl_pending}
        if extra:
            result.update(extra)
        return result
    return fake_ask_agent


# Pre-seed the lazy-import module globals so _import_gemini() returns our fakes
# without importing the real gemini (which needs a live LLM environment).
we._ask_agent = make_ask_agent()
we._get_retrievers = fake_get_retrievers


# --- A canvas flow with an AI Agent -> telegram_send (placeholder token) ---
def _ai_flow(system_prompt="be concise", mode="statarb"):
    return {
        "masterEnabled": True,
        "nodes": {
            "n_ai": {
                "typeId": "ai-agent",
                "label": "AI Agent",
                "position": {"x": 100, "y": 100},
                "config": {"system_prompt": system_prompt, "temperature": "0.2", "mode": mode},
                "enabled": True,
            },
            "n_tg": {
                "typeId": "telegram_send",
                "label": "Telegram",
                "position": {"x": 400, "y": 100},
                "config": {"telegram_token": "http://placeholder", "chat_id": "123"},
                "enabled": True,
            },
            "n_http": {
                "typeId": "http-response",
                "label": "Respond",
                "position": {"x": 600, "y": 100},
                "config": {"status_code": "200"},
                "enabled": True,
            },
        },
        "edges": [
            {"id": "e1", "source": "n_ai", "sourceHandle": "out-response", "target": "n_tg", "targetHandle": "in"},
            {"id": "e2", "source": "n_ai", "sourceHandle": "out-response", "target": "n_http", "targetHandle": "in"},
        ],
    }


def test_ai_node_mode_and_system_prompt_propagated():
    we._ask_agent = make_ask_agent(response="hello-back")
    result = we.run_flow("tenant-1", "hi", customer_id="cust-1", flow=_ai_flow(mode="statarb", system_prompt="shout"))
    assert captured["mode"] == "statarb", captured
    assert captured["system_prompt"] == "shout", captured
    assert captured["tenant_id"] == "tenant-1"
    assert captured["customer_id"] == "cust-1"
    assert result["response"] == "hello-back"
    assert result["flow_node"] == "ai-agent"
    # Both output nodes connected to the AI node should have been attempted.
    assert len(result["actions"]) == 2, result["actions"]
    tg = [a for a in result["actions"] if a["node"] == "telegram_send"][0]
    assert tg.get("skipped") == "telegram token is a placeholder"
    http = [a for a in result["actions"] if a["node"] == "http-response"][0]
    assert http["status_code"] == "200"


def test_no_ai_node_falls_back_to_mode_hint():
    # Flow with only an http-response node (no AI Agent) -> ask_agent still runs
    # with the mode_hint, and actions are empty.
    we._ask_agent = make_ask_agent(response="fallback")
    flow = {
        "masterEnabled": True,
        "nodes": {
            "n_http": {"typeId": "http-response", "label": "Respond", "position": {"x": 0, "y": 0},
                       "config": {"status_code": "200"}, "enabled": True},
        },
        "edges": [],
    }
    result = we.run_flow("tenant-1", "ping", mode_hint="support", flow=flow)
    assert captured["mode"] == "support"
    assert result["flow_node"] is None
    assert result["actions"] == []


def test_disabled_flow_skips_outputs_but_still_runs_ai():
    we._ask_agent = make_ask_agent(response="still-runs")
    flow = _ai_flow(mode="statarb")
    flow["masterEnabled"] = False  # canvas gateway off
    result = we.run_flow("tenant-1", "hi", flow=flow)
    assert result["response"] == "still-runs"  # AI node still ran
    assert result["actions"] == []             # but outputs not executed


def test_hitl_output_only_traversed_when_pending():
    we._ask_agent = make_ask_agent(response="need-human", hitl_pending=True,
                                   extra={"hitl_action": "escalate"})
    flow = {
        "masterEnabled": True,
        "nodes": {
            "n_ai": {"typeId": "ai-agent", "label": "AI", "position": {"x": 0, "y": 0},
                     "config": {"mode": "statarb", "system_prompt": ""}, "enabled": True},
            "n_blocked": {"typeId": "telegram_send", "label": "Tg", "position": {"x": 1, "y": 1},
                          "config": {"telegram_token": "http://placeholder"}, "enabled": True},
            "n_hitl": {"typeId": "http-response", "label": "HitlGate", "position": {"x": 2, "y": 2},
                       "config": {"status_code": "200"}, "enabled": True},
        },
        "edges": [
            # out-hitl only fires when hitl is pending
            {"id": "e1", "source": "n_ai", "sourceHandle": "out-hitl", "target": "n_hitl", "targetHandle": "in"},
            # out-response is skipped while hitl is pending
            {"id": "e2", "source": "n_ai", "sourceHandle": "out-response", "target": "n_blocked", "targetHandle": "in"},
        ],
    }
    result = we.run_flow("tenant-1", "sensitive", flow=flow)
    assert result["hitl_pending"] is True
    executed = [a["node"] for a in result["actions"]]
    assert "http-response" in executed
    assert "telegram_send" not in executed


def test_saved_flow_is_loaded_from_tenant_when_no_override():
    # When `flow` is not passed, get_tenant_flow is used. Monkeypatch it.
    we._ask_agent = make_ask_agent(response="loaded")
    base = _ai_flow(mode="statarb")
    we.get_tenant_flow = lambda tenant_id: (base["nodes"], base["edges"], True)
    try:
        result = we.run_flow("tenant-1", "hi")
        assert captured["mode"] == "statarb"
        assert result["flow_node"] == "ai-agent"
    finally:
        del we.get_tenant_flow  # restore


def _ai_node(config=None):
    return {
        "typeId": "ai-agent",
        "label": "AI",
        "position": {"x": 0, "y": 0},
        "config": config or {"mode": "statarb", "system_prompt": ""},
        "enabled": True,
    }


def test_delay_router_loop_and_chain_are_engine_backed():
    """delay/router/loop must be executed (not 'handled: False') and a drawn
    chain ai-agent -> delay -> http-response must traverse end to end."""
    flow = {
        "masterEnabled": True,
        "nodes": {
            "n_ai": _ai_node(),
            "n_delay": {
                "typeId": "delay", "label": "Wait", "position": {"x": 1, "y": 0},
                "config": {"delay_seconds": "3", "delay_mode": "fixed_seconds"},
                "enabled": True,
            },
            "n_hr": {
                "typeId": "http-response", "label": "Respond", "position": {"x": 2, "y": 0},
                "config": {"status_code": "202"}, "enabled": True,
            },
        },
        "edges": [
            {"id": "e1", "source": "n_ai", "sourceHandle": "out-response", "target": "n_delay", "targetHandle": "in"},
            {"id": "e2", "source": "n_delay", "target": "n_hr", "targetHandle": "in"},
        ],
    }
    we._ask_agent = make_ask_agent(response="after-delay")
    res = we.run_flow("t1", "hi", flow=flow)
    executed = {a["node"]: a for a in res["actions"]}
    assert executed["delay"]["delay_seconds"] == 3, executed
    assert executed["http-response"]["status_code"] == "202", executed
    assert all("handled" not in a for a in res["actions"]), res["actions"]


def test_router_and_loop_arguments_respected():
    """router and loop read their real arguments from config."""
    flow = {
        "masterEnabled": True,
        "nodes": {
            "n_ai": _ai_node(),
            "n_loop": {
                "typeId": "loop", "label": "Loop", "position": {"x": 1, "y": 0},
                "config": {"collection": "[1,2,3]", "item_var": "x", "max_iterations": "10"},
                "enabled": True,
            },
            "n_router": {
                "typeId": "router", "label": "Pick", "position": {"x": 2, "y": 0},
                "config": {"field": "{{cat}}", "routes": '[{"value":"a"}]', "default_route": "fallback"},
                "enabled": True,
            },
        },
        "edges": [
            {"id": "e1", "source": "n_ai", "sourceHandle": "out-response", "target": "n_loop", "targetHandle": "in"},
            {"id": "e2", "source": "n_ai", "sourceHandle": "out-response", "target": "n_router", "targetHandle": "in"},
        ],
    }
    we._ask_agent = make_ask_agent(response="v")
    res = we.run_flow("t1", "hi", flow=flow)
    executed = {a["node"]: a for a in res["actions"]}
    assert executed["loop"]["iterations"] == 3, executed
    assert executed["loop"]["item_var"] == "x", executed
    assert executed["router"]["routed_to"] == "fallback", executed
    assert all("handled" not in a for a in res["actions"]), res["actions"]


def test_http_request_is_engine_backed():
    """http_request makes a real outbound call and reports the status code."""
    flow = {
        "masterEnabled": True,
        "nodes": {
            "n_ai": _ai_node(),
            "n_req": {
                "typeId": "http_request", "label": "API", "position": {"x": 1, "y": 0},
                "config": {"method": "POST", "url": "https://x.test/webhook",
                           "headers": "{}", "body": '{"k": 1}'},
                "enabled": True,
            },
        },
        "edges": [
            {"id": "e1", "source": "n_ai", "sourceHandle": "out-response", "target": "n_req", "targetHandle": "in"},
        ],
    }
    we._ask_agent = make_ask_agent(response="v")

    class _Resp:
        status_code = 200

    real_request = we.requests.request
    called = {}

    def fake_request(method, url, json=None, headers=None, timeout=None):
        called["method"] = method
        called["url"] = url
        return _Resp()

    we.requests.request = fake_request
    try:
        res = we.run_flow("t1", "hi", flow=flow)
    finally:
        we.requests.request = real_request

    assert res["actions"][0]["node"] == "http_request", res["actions"]
    assert res["actions"][0]["status_code"] == 200, res["actions"]
    assert called["method"] == "POST", called
    assert called["url"] == "https://x.test/webhook", called
    assert all("handled" not in a for a in res["actions"]), res["actions"]


def test_metrics_node_writes_to_telemetry():
    """A `metrics` output node resolves its value_template against the AI result
    and persists a telemetry_metrics record (run_id / node_id included).

    Mirrors test_http_request_is_engine_backed — the external Supabase write is
    patched so no network/DB is required.
    """
    flow = {
        "masterEnabled": True,
        "nodes": {
            "n_ai": _ai_node(),
            "n_met": {
                "typeId": "metrics",
                "label": "Metric",
                "id": "n_met",
                "position": {"x": 400, "y": 0},
                "config": {
                    "metric_name": "response_time",
                    "metric_type": "gauge",
                    "value_template": "{{response.duration_ms}}",
                    "tags": '{"channel":"api"}',
                    "unit": "ms",
                },
                "enabled": True,
            },
        },
        "edges": [
            {"id": "e1", "source": "n_ai", "sourceHandle": "out-response", "target": "n_met", "targetHandle": "in"},
        ],
    }
    # The AI result carries a structured field the template can read.
    we._ask_agent = make_ask_agent(response="hi", extra={"duration_ms": 42})

    captured = {}

    def fake_record(tenant_id, record):
        captured["tenant"] = tenant_id
        captured["record"] = record
        return None

    real_record = we._record_metric
    we._record_metric = fake_record
    try:
        res = we.run_flow("tenant-1", "hello", flow=flow)
    finally:
        we._record_metric = real_record

    assert captured["tenant"] == "tenant-1", captured
    rec = captured["record"]
    assert rec["metric_name"] == "response_time", rec
    assert rec["metric_type"] == "gauge", rec
    assert rec["value"] == 42.0, rec
    assert rec["value_expression"] == "{{response.duration_ms}}", rec
    assert rec["tags"] == {"channel": "api"}, rec
    assert rec["unit"] == "ms", rec
    assert rec["node_id"] == "n_met", rec
    assert rec["run_id"], rec
    assert "ts" in rec, rec

    action = res["actions"][0]
    assert action["node"] == "metrics", res["actions"]
    assert action["recorded"] is True, res["actions"]
    assert action["value"] == 42.0, res["actions"]
    assert action["metric_type"] == "gauge", res["actions"]
    print("  [ok] metrics_node_writes_to_telemetry:", rec)


def test_new_nodes_are_handled_not_unhandled():
    """Guardrail for #3: delay/router/loop/http_request/http-response must not
    fall through to 'handled: False' when executed by the engine."""
    for t in ("delay", "router", "loop", "http-response", "http_request", "metrics"):
        handled = we._execute_output_node({"typeId": t, "config": {}}, "tenant-1", "r")
        assert "handled" not in handled, (t, handled)
        assert "skipped" in handled or "error" in handled or "status_code" in handled or "delay_seconds" in handled or "iterations" in handled or "routed_to" in handled, (t, handled)


if __name__ == "__main__":
    test_ai_node_mode_and_system_prompt_propagated()
    print("[ok] ai_node_mode_and_system_prompt_propagated")
    test_no_ai_node_falls_back_to_mode_hint()
    print("[ok] no_ai_node_falls_back_to_mode_hint")
    test_disabled_flow_skips_outputs_but_still_runs_ai()
    print("[ok] disabled_flow_skips_outputs_but_still_runs_ai")
    test_hitl_output_only_traversed_when_pending()
    print("[ok] hitl_output_only_traversed_when_pending")
    test_saved_flow_is_loaded_from_tenant_when_no_override()
    print("[ok] saved_flow_is_loaded_from_tenant_when_no_override")
    test_delay_router_loop_and_chain_are_engine_backed()
    print("[ok] delay_router_loop_and_chain_are_engine_backed")
    test_router_and_loop_arguments_respected()
    print("[ok] router_and_loop_arguments_respected")
    test_http_request_is_engine_backed()
    print("[ok] http_request_is_engine_backed")
    test_new_nodes_are_handled_not_unhandled()
    print("[ok] new_nodes_are_handled_not_unhandled")
    test_metrics_node_writes_to_telemetry()
    print("[ok] metrics_node_writes_to_telemetry")
    print("ALL WORKFLOW ENGINE TESTS PASSED")

