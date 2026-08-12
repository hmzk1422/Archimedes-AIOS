"""Isolated smoke test for the AI-mode helper functions in gemini.py.

Extracts the real function source with AST (so no heavy module import /
LLM/embedding/ranker init is triggered) and exercises each function against
a mocked `requests` layer, asserting the exact Supabase query each one builds.
"""
import ast
import json
import os
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_PATH = os.path.join(os.path.dirname(HERE), "gemini.py")  # api/gemini.py

TARGETS = [
    "get_tenant_active_mode",
    "fetch_agent_tasks_for_mode",
    "fetch_mode_custom_instruction",
    "fetch_dynamic_tasks",
    "get_retrievers_for_tenant",
]

with open(SRC_PATH, encoding="utf-8") as fh:
    tree = ast.parse(fh.read())

funcs = {}
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in TARGETS:
        funcs[node.name] = node

missing = [n for n in TARGETS if n not in funcs]
if missing:
    print(f"FAIL: missing functions in gemini.py: {missing}")
    sys.exit(1)


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else []
        self.text = text

    def json(self):
        return self._payload


recorded = []


class FakeRequests:
    @staticmethod
    def get(url, headers=None, timeout=None):
        recorded.append({"url": url, "headers": headers, "timeout": timeout})
        # Route deterministic canned responses by the datatype/filename in the URL.
        if "datatype=eq.agent_tasks" in url:
            return FakeResponse(
                200,
                [{"data": json.dumps({"tasks": [{"name": "process_refund", "datatype": "billing"}]})}],
            )
        if "datatype=eq.custom_instructions" in url:
            return FakeResponse(200, [{"data": {"instruction": "Refund policy for this mode."}}])
        if "rest/v1/profiles" in url:  # get_tenant_active_mode profile fetch
            return FakeResponse(200, [{"mode": {"active": "sales"}}])
        if url.endswith("&select=data&limit=1"):  # coverage fallback
            return FakeResponse(404, [], "not found")
        return FakeResponse(200, [])


def _stub_discover(tenant_id):
    return ["statarb", "investment", "research"]


def _stub_preprocess(tenant_id=None, datatype_label=None, **kwargs):
    return {"datatype": datatype_label}


ns = {
    "os": os,
    "json": json,
    "time": time,
    "urllib": urllib,
    "urllib.parse": urllib.parse,
    "requests": FakeRequests,
    "SUPABASE_KEY": "fake-supabase-key",
    "SUPABASE_URL": "https://fake.supabase.co",
    "_tenant_mode_cache": {},
    "_MODE_TTL_SECONDS": 120,
    "discover_datatypes": _stub_discover,
    "preprocess": _stub_preprocess,
    "_retriever_cache": {},
}

for name in TARGETS:
    mod = ast.Module(body=[funcs[name]], type_ignores=[])
    ast.fix_missing_locations(mod)
    code = compile(mod, f"<{name}>", "exec")
    exec(code, ns)

os.environ["CUSTOMER_SERVICE_PROVIDER"] = "https://fake.supabase.co/rest/v1/rpc/csp"
os.environ["SUPADB_API"] = "fake-supabase-key"

failures = []

# ---- 1. get_tenant_active_mode -------------------------------------------
mode = ns["get_tenant_active_mode"]("tenant-123")
assert mode == "sales", f"expected sales, got {mode!r}"
print("  [ok] get_tenant_active_mode ->", mode)

# cache hit path
# cache hit path
ns["_tenant_mode_cache"]["tenant-123"] = (time.monotonic(), "billing")
mode2 = ns["get_tenant_active_mode"]("tenant-123")
assert mode2 == "billing", f"expected cached billing, got {mode2!r}"
print("  [ok] get_tenant_active_mode (cache) ->", mode2)

# ---- 2. fetch_agent_tasks_for_mode ---------------------------------------
recorded.clear()
tasks = ns["fetch_agent_tasks_for_mode"]("tenant-123", mode="billing")
assert tasks == [{"name": "process_refund", "datatype": "billing"}], tasks
u = recorded[-1]["url"]
assert "datatype=eq.agent_tasks" in u and "filename=eq.billing" in u, u
assert "tenant_id=eq.tenant-123" in u, u
print("  [ok] fetch_agent_tasks_for_mode URL:", u)

# mode defaults to active mode when omitted
ns["_tenant_mode_cache"].clear()
recorded.clear()
tasks = ns["fetch_agent_tasks_for_mode"]("tenant-123", mode=None)
u = recorded[-1]["url"]
assert "filename=eq.sales" in u, u  # active mode from profile fetch
print("  [ok] fetch_agent_tasks_for_mode (default mode) URL:", u)

# ---- 3. fetch_mode_custom_instruction ------------------------------------
recorded.clear()
inst = ns["fetch_mode_custom_instruction"]("tenant-123", mode="billing")
assert inst == "Refund policy for this mode.", inst
u = recorded[-1]["url"]
assert "datatype=eq.custom_instructions" in u and "filename=eq.billing" in u, u
print("  [ok] fetch_mode_custom_instruction URL:", u)

# explicit empty for a mode -> '' (not None) => caller falls through correctly
recorded.clear()
inst = ns["fetch_mode_custom_instruction"]("tenant-123", mode=None)
assert inst is None, inst
print("  [ok] fetch_mode_custom_instruction (no mode) -> None")

# ---- 4. fetch_dynamic_tasks ----------------------------------------------
recorded.clear()
dyn = ns["fetch_dynamic_tasks"]("tenant-123", mode="sales")
assert dyn == [{"name": "process_refund", "datatype": "billing"}], dyn
u = recorded[-1]["url"]
assert "datatype=eq.agent_tasks" in u and "filename=eq.sales" in u, u
print("  [ok] fetch_dynamic_tasks URL:", u)

# default-mode path when mode omitted
ns["_tenant_mode_cache"].clear()
recorded.clear()
dyn = ns["fetch_dynamic_tasks"]("tenant-123", mode=None)
u = recorded[-1]["url"]
assert "filename=eq.sales" in u, u
print("  [ok] fetch_dynamic_tasks (default mode) URL:", u)

# ---- 5. graceful failure: non-200 ----------------------------------------
recorded.clear()


class ErrReq:
    @staticmethod
    def get(url, headers=None, timeout=None):
        return FakeResponse(500, [], "boom")


ns["requests"] = ErrReq
dyn = ns["fetch_dynamic_tasks"]("tenant-123", mode="sales")
assert dyn == [], dyn
tasks = ns["fetch_agent_tasks_for_mode"]("tenant-123", mode="sales")
assert tasks == [], tasks
print("  [ok] non-200 -> empty list (graceful)")

# ---- 6. get_retrievers_for_tenant mode scoping ----------------------------
ns["_retriever_cache"].clear()
all_ret = ns["get_retrievers_for_tenant"]("tenant-123", None)
assert set(all_ret.keys()) == {"statarb", "investment", "research"}, all_ret
ns["_retriever_cache"].clear()
stat_ret = ns["get_retrievers_for_tenant"]("tenant-123", "statarb")
assert set(stat_ret.keys()) == {"statarb"}, stat_ret
ns["_retriever_cache"].clear()
inv_ret = ns["get_retrievers_for_tenant"]("tenant-123", "investment")
assert set(inv_ret.keys()) == {"investment"}, inv_ret
print("  [ok] get_retrievers_for_tenant mode-scoping:",
      sorted(all_ret.keys()), sorted(stat_ret.keys()), sorted(inv_ret.keys()))

print("\nALL MODE SMOKE TESTS PASSED")
