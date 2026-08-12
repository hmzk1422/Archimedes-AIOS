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
    print("ALL WORKFLOW ENGINE TESTS PASSED")

