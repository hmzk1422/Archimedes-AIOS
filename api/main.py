import os
import json
import requests
import urllib.parse
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from gemini import ask_agent, get_retrievers_for_tenant, preprocess, delete_knowledge_file, delete_all_tenant_data, fetch_mode_custom_instruction, get_tenant_active_mode
from workflow_engine import run_flow
from telemetry_sdk import get_telemetry, reset_telemetry, record_metric
from supabase import create_client, Client
from hitl import fetch_hitl_config, evaluate_hitl, HITLDecision, detect_sentiment, fetch_task_names

# 1. CREATE THE APP FIRST
app = FastAPI()

# 2. THEN CONFIGURE THE MIDDLEWARE (using the app instance you just created)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. THEN DEFINE YOUR ROUTES
class ChatRequest(BaseModel):
    message: str
    tenant_id: str | None = None
    customer_id: str | None = None


class ChatApproveRequest(BaseModel):
    """User confirms or rejects a pending HITL tool call."""
    tenant_id: str | None = None
    customer_id: str | None = None
    approve: bool = True


class IngestRequest(BaseModel):
    tenant_id: str
    datatype: str | None = "policies"

from fastapi import BackgroundTasks

class DeleteKnowledgeRequest(BaseModel):
    tenant_id: str
    datatype: str
    file_name: str


@app.post("/ingest")
async def ingest_endpoint(request: IngestRequest, background_tasks: BackgroundTasks):
    """Trigger preprocessing in the background."""
    try:
        # ✅ FIX: Guard against empty tenant_id. An empty string was previously
        # passed straight through to preprocess(), resulting in tenant_scope=""
        # and documents stored with tenant_id="" (NULL in JSONB). Default to
        # "global" so every vectorized document always carries a non-empty
        # tenant_id.
        effective_tenant_id = request.tenant_id or "global"
        background_tasks.add_task(
            preprocess,
            tenant_id=effective_tenant_id,
            datatype_label=request.datatype
        )
        return {"status": "ok", "message": "Ingestion started in the background"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/chat")
async def chat_endpoint(data: dict):
    try:
        user_input = data.get("message")
        tenant_id = data.get("tenant_id")
        customer_id = data.get("customer_id")
        mode = data.get("mode") or data.get("datatype")

        if not user_input:
            return {"status": "error", "message": "No message provided"}

        # Instantly builds retrievers without running heavy pipeline tasks.
        # When a node/flow passes a mode (e.g. "statarb"), scope the knowledge
        # base, custom instructions and tasks to that mode only.
        retrievers = get_retrievers_for_tenant(tenant_id, mode=mode)
        result = ask_agent(user_input, retrievers, tenant_id, customer_id, mode=mode)

        # result is now a dict with structured fields
        return {
            "status": "ok",
            "response": result.get("response", ""),
            "hitl_pending": result.get("hitl_pending", False),
            "hitl_action": result.get("hitl_action"),
            "hitl_reason": result.get("hitl_reason"),
            "tool_executed": result.get("tool_executed"),
            "tool_output": result.get("tool_output"),
        }

    except Exception as e:
        import traceback
        print(f"❌ BACKEND CRASH IN /chat: {str(e)}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}


@app.post("/chat/approve")
async def chat_approve_endpoint(request: ChatApproveRequest):
    """User confirms or rejects a pending HITL tool call."""
    try:
        tenant_id = request.tenant_id
        customer_id = request.customer_id
        approve = request.approve

        # Send the approval decision back through ask_agent
        # The "message" is a special keyword that the gate check in ask_agent recognizes
        decision_text = "yes" if approve else "no"
        retrievers = get_retrievers_for_tenant(tenant_id)
        result = ask_agent(decision_text, retrievers, tenant_id, customer_id)

        return {
            "status": "ok",
            "response": result.get("response", ""),
            "hitl_pending": result.get("hitl_pending", False),
            "tool_executed": result.get("tool_executed"),
            "tool_output": result.get("tool_output"),
        }
    except Exception as e:
        import traceback
        print(f"❌ BACKEND CRASH IN /chat/approve: {str(e)}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}


@app.post("/chat/stream")
async def chat_stream_endpoint(data: dict):
    """Stream the chat response as SSE events for real-time UI updates."""
    import asyncio
    try:
        user_input = data.get("message")
        tenant_id = data.get("tenant_id")
        customer_id = data.get("customer_id")
        mode = data.get("mode") or data.get("datatype")

        if not user_input:
            return {"status": "error", "message": "No message provided"}

        retrievers = get_retrievers_for_tenant(tenant_id, mode=mode)
        result = ask_agent(user_input, retrievers, tenant_id, customer_id, mode=mode)

        response_text = result.get("response", "")
        hitl_pending = result.get("hitl_pending", False)

        async def event_stream():
            # Stream the response text character-by-character for real-time effect
            words = response_text.split(" ")
            for i, word in enumerate(words):
                chunk = word + (" " if i < len(words) - 1 else "")
                yield f"data: {json.dumps({'type': 'chunk', 'text': chunk})}\n\n"
                await asyncio.sleep(0.02)  # ~50 chars/sec typing effect

            # Send the final structured event with full metadata
            done_event = {
                'type': 'done',
                'response': response_text,
                'hitl_pending': hitl_pending,
                'hitl_action': result.get('hitl_action'),
                'hitl_reason': result.get('hitl_reason'),
                'tool_executed': result.get('tool_executed'),
                'tool_output': result.get('tool_output'),
            }
            yield f"data: {json.dumps(done_event)}\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except Exception as e:
        import traceback
        print(f"❌ BACKEND CRASH IN /chat/stream: {str(e)}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}


@app.post("/knowledge/delete")
async def delete_knowledge_endpoint(request: DeleteKnowledgeRequest):
    """Delete the indexed knowledge rows for a file that was removed from storage."""
    try:
        result = delete_knowledge_file(request.tenant_id, request.datatype, request.file_name)
        return {"status": "ok", **result}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


class CustomInstructionRequest(BaseModel):
    tenant_id: str
    mode: str | None = None
    instruction: str = ""


class WorkflowRunRequest(BaseModel):
    tenant_id: str
    message: str
    customer_id: str | None = None
    mode: str | None = None
    # When present, this is the live canvas config (drawn flow), used directly
    # instead of reloading the tenant's saved flow — enables Run-as-drawn.
    flow: dict | None = None


@app.get("/knowledge/custom-instruction")
async def get_custom_instruction(tenant_id: str, mode: str | None = None):
    """Return the per-AI-mode custom instruction, falling back to the legacy profile column."""
    try:
        effective_mode = mode or get_tenant_active_mode(tenant_id)
        instruction = fetch_mode_custom_instruction(tenant_id, effective_mode)
        if instruction is not None and instruction.strip():
            return {"status": "ok", "mode": effective_mode, "instruction": instruction}

        # Fallback to the legacy profiles.custom_instruction column
        headers = {
            "apikey": os.getenv("SUPADB_API"),
            "Authorization": f"Bearer {os.getenv('SUPADB_API')}",
        }
        profile_instr = ""
        resp = requests.get(
            f"{os.getenv('SUPABASE_URL')}/rest/v1/profiles?id=eq.{tenant_id}&select=custom_instruction&limit=1",
            headers=headers,
            timeout=10,
        )
        if resp.status_code == 200 and (resp.json() or []):
            profile_instr = resp.json()[0].get("custom_instruction") or ""
        return {"status": "ok", "mode": effective_mode, "instruction": profile_instr or ""}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.post("/knowledge/custom-instruction")
async def save_custom_instruction(request: CustomInstructionRequest):
    """Save (upsert) the per-AI-mode custom instruction into customer-service-provider.

    Row: datatype='custom_instructions', filename=<mode>, tenant_id, data={"instruction": ...}
    Mirrors the dashboard_config insert-then-patch upsert pattern.
    """
    try:
        SUPABASE_KEY = os.getenv("SUPADB_API")
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
        if not rest_url or not SUPABASE_KEY:
            return {"status": "error", "message": "Database not configured"}

        mode = request.mode or get_tenant_active_mode(request.tenant_id)
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        payload = {
            "datatype": "custom_instructions",
            "filename": mode,
            "tenant_id": request.tenant_id,
            "data": {"instruction": request.instruction},
        }

        response = requests.post(rest_url, json=payload, headers=headers, timeout=10)
        if response.status_code in (200, 201):
            return {"status": "ok", "message": "Custom instruction saved", "mode": mode}

        if response.status_code == 409 or "23505" in response.text or "duplicate" in response.text.lower():
            encoded = urllib.parse.quote(mode, safe="")
            patch_response = requests.patch(
                f"{rest_url}?datatype=eq.custom_instructions&filename=eq.{encoded}&tenant_id=eq.{request.tenant_id}",
                json={"data": payload["data"]},
                headers=headers,
                timeout=10,
            )
            if patch_response.status_code in (200, 204):
                return {"status": "ok", "message": "Custom instruction updated", "mode": mode}
            return {"status": "error", "message": f"Update failed: {patch_response.text}"}

        return {"status": "error", "message": f"Save failed: {response.text}"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.post("/workflow/execute")
async def workflow_execute_endpoint(request: WorkflowRunRequest):
    """Execute the tenant's saved canvas flow (drag-and-drop) for one message.

    Loads the flow the canvas saved under profiles.extension, runs the AI Agent
    node (scoped to its mode + system_prompt) and executes output nodes. Falls
    back to a normal ask_agent call when the flow has no AI Agent node.
    """
    try:
        import asyncio

        result = await asyncio.to_thread(
            run_flow,
            request.tenant_id,
            request.message,
            request.customer_id,
            mode_hint=request.mode,
            flow=request.flow,
        )
        return {
            "status": "ok",
            "response": result.get("response", ""),
            "hitl_pending": result.get("hitl_pending", False),
            "hitl_action": result.get("hitl_action"),
            "hitl_reason": result.get("hitl_reason"),
            "tool_executed": result.get("tool_executed"),
            "tool_output": result.get("tool_output"),
            "flow_node": result.get("flow_node"),
            "actions": result.get("actions", []),
        }
    except Exception as exc:
        import traceback

        print(f"BACKEND CRASH IN /workflow/execute: {str(exc)}")
        traceback.print_exc()
        return {"status": "error", "message": str(exc)}



class AccountDeleteRequest(BaseModel):
    tenant_id: str


@app.post("/account/delete")
async def account_delete_endpoint(request: AccountDeleteRequest):
    """
    Delete ALL knowledge data for a tenant (workspace): raw parsed rows,
    pgvector documents, and storage files. Called when an account/workspace is
    deleted so no orphaned data (which could later bleed into a new tenant)
    is left in the database.
    """
    try:
        result = delete_all_tenant_data(request.tenant_id)
        return {"status": "ok", **result}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.get("/storage-list")
async def storage_list(tenant_id: str | None = None):
    """Debug endpoint: return the list of object names under the tenant root."""
    bucket = os.getenv("SUPABASE_BUCKET", "customer-service-provider")
    tenant_scope = (tenant_id or "").strip("/")
    try:
        items = preprocess.__globals__["supabase"].storage.from_(bucket).list(path=tenant_scope)
        # Return simplified list of names
        names = [i.get("name") for i in (items or [])]
        return {"status": "ok", "items": names}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ──────────────────────────────────────────────
# Telemetry & Evaluation API Endpoints
# ──────────────────────────────────────────────


class TelemetryLogRequest(BaseModel):
    tenant_id: str
    event_type: str
    attributes: dict | None = None
    service_name: str = "relay-agent"
    otlp_endpoint: str | None = None


class TelemetryMetricRequest(BaseModel):
    tenant_id: str
    metric_name: str
    value: float
    tags: dict[str, str] | None = None
    metric_type: str = "counter"
    service_name: str = "relay-agent"
    otlp_endpoint: str | None = None


class EvaluationRecordRequest(BaseModel):
    tenant_id: str
    evaluation_name: str
    score: float
    metadata: dict | None = None
    service_name: str = "relay-agent"
    otlp_endpoint: str | None = None


@app.post("/telemetry/log")
async def telemetry_log(request: TelemetryLogRequest):
    """Log a custom agent event via the RelayTelemetry SDK."""
    try:
        telemetry = get_telemetry(
            service_name=request.service_name,
            tenant_id=request.tenant_id,
            otlp_endpoint=request.otlp_endpoint,
        )
        telemetry.log(request.event_type, request.attributes)
        return {"status": "ok", "message": f"Event '{request.event_type}' logged"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/telemetry/metric")
async def telemetry_metric(request: TelemetryMetricRequest):
    """Record a custom metric via the RelayTelemetry SDK."""
    try:
        telemetry = get_telemetry(
            service_name=request.service_name,
            tenant_id=request.tenant_id,
            otlp_endpoint=request.otlp_endpoint,
        )
        telemetry.metric(
            request.metric_name,
            request.value,
            tags=request.tags,
            metric_type=request.metric_type,
        )
        return {"status": "ok", "message": f"Metric '{request.metric_name}' recorded"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/telemetry/evaluation")
async def telemetry_evaluation(request: EvaluationRecordRequest):
    """Record a custom evaluation score via the RelayTelemetry SDK."""
    try:
        telemetry = get_telemetry(
            service_name=request.service_name,
            tenant_id=request.tenant_id,
            otlp_endpoint=request.otlp_endpoint,
        )
        telemetry.record_evaluation(
            request.evaluation_name,
            request.score,
            metadata=request.metadata,
        )
        return {"status": "ok", "message": f"Evaluation '{request.evaluation_name}' recorded"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ──────────────────────────────────────────────
# Metrics API Endpoints
# ──────────────────────────────────────────────


class MetricsRequest(BaseModel):
    """A single metric write — mirrors what the canvas `metrics` node emits."""
    tenant_id: str
    metric_name: str
    value: float | None = None
    metric_type: str = "counter"
    tags: dict | None = None
    value_expression: str | None = None
    evaluation_name: str | None = None
    score_min: float | None = None
    score_max: float | None = None
    unit: str | None = None
    run_id: str | None = None
    node_id: str | None = None
    bot_id: str | None = None


class MetricsBulkRequest(BaseModel):
    """Batch write metrics; every item must share the same tenant_id (RLS scope)."""
    metrics: list[MetricsRequest]


@app.post("/metrics")
async def record_metric_endpoint(request: MetricsRequest):
    """Persist a metric row (datatype=telemetry_metrics) for the calling tenant.

    Tenant isolation is enforced by RLS + tenant_id scoping in the writer; a
    request cannot write a row for another tenant. Mirrors the engine's
    `metrics` output node write path (POST /metrics or /metrics/bulk).
    """
    try:
        record_metric(
            tenant_id=request.tenant_id, metric_name=request.metric_name,
            value=request.value, metric_type=request.metric_type, tags=request.tags,
            value_expression=request.value_expression, evaluation_name=request.evaluation_name,
            score_min=request.score_min, score_max=request.score_max, unit=request.unit,
            run_id=request.run_id, node_id=request.node_id, bot_id=request.bot_id,
        )
        return {"status": "ok", "message": f"Metric '{request.metric_name}' recorded"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/metrics/bulk")
async def record_metric_bulk_endpoint(request: MetricsBulkRequest):
    """Batch write metrics for a tenant in one call."""
    if not request.metrics:
        return {"status": "ok", "count": 0, "message": "No metrics provided"}
    tenant_id = request.metrics[0].tenant_id
    for item in request.metrics:
        if item.tenant_id != tenant_id:
            return {"status": "error", "message": "All metrics must share the same tenant_id"}
        record_metric(
            tenant_id=item.tenant_id, metric_name=item.metric_name, value=item.value,
            metric_type=item.metric_type, tags=item.tags, value_expression=item.value_expression,
            evaluation_name=item.evaluation_name, score_min=item.score_min,
            score_max=item.score_max, unit=item.unit, run_id=item.run_id,
            node_id=item.node_id, bot_id=item.bot_id,
        )
    return {
        "status": "ok",
        "count": len(request.metrics),
        "message": f"{len(request.metrics)} metrics recorded",
    }


@app.get("/metrics/{tenant_id}")
async def get_metrics(
    tenant_id: str,
    metric_name: str | None = None,
    group_by: str | None = None,
    agg: str = "avg",
    field: str = "value",
    tags: str | None = None,
    limit: int = 500,
):
    """Config-driven metric aggregation powering dynamic dashboard widgets.

    Pulls `telemetry_metrics` rows for a tenant (via the same generic
    customer-service-provider table the canvas `metrics` node writes to), then
    filters by metric_name and tag filters, groups by a dynamic dimension and
    aggregates a numeric field.

    The grouping dimension (`group_by`) can be:
      * a dotted tags path, e.g. ``tags.channel`` or ``tags.keyword``
      * ``metric_name`` to compare several metrics side-by-side
      * any top-level key of the record, e.g. ``evaluation_name`` or ``run_id``

    `agg` is one of avg|sum|max|min|count|distinct. `tags` is a URL-encoded JSON
    filter, e.g. ``{"risk":"high"}`` (all pairs must match on each row).
    """
    try:
        SUPABASE_KEY = os.getenv("SUPADB_API")
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
        if not rest_url or not SUPABASE_KEY:
            return {"status": "error", "message": "Database not configured"}

        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
        query = (
            f"{rest_url}?datatype=eq.telemetry_metrics&tenant_id=eq.{tenant_id}"
            f"&order=timestamp.desc&limit={limit}"
        )
        resp = requests.get(query, headers=headers, timeout=10)
        rows = resp.json() if resp.status_code == 200 else []

        # metric_name / tags live inside the `data` jsonb column
        raw = [r.get("data", {}) for r in rows if isinstance(r.get("data"), dict)]

        if metric_name:
            raw = [d for d in raw if d.get("metric_name") == metric_name]

        tag_filter: dict = {}
        if tags:
            try:
                parsed = json.loads(tags)
                if isinstance(parsed, dict):
                    tag_filter = parsed
            except Exception:
                tag_filter = {}
        if tag_filter:
            kept = []
            for d in raw:
                rec_tags = d.get("tags") if isinstance(d.get("tags"), dict) else {}
                if all(rec_tags.get(k) == v for k, v in tag_filter.items()):
                    kept.append(d)
            raw = kept

        def _num(v):
            if isinstance(v, bool):
                return None
            if isinstance(v, (int, float)):
                return float(v)
            if isinstance(v, str):
                try:
                    return float(v)
                except Exception:
                    return None
            return None

        def _group_label(d, gdim):
            if gdim.startswith("tags."):
                rec_tags = d.get("tags") if isinstance(d.get("tags"), dict) else {}
                return str(rec_tags.get(gdim[5:], ""))
            if gdim == "metric_name":
                return str(d.get("metric_name", ""))
            return str(d.get(gdim, ""))

        groups: dict[str, list[float]] = {}
        for d in raw:
            val = _num(d.get(field))
            if val is None:
                continue
            label = _group_label(d, group_by) if group_by else "__all__"
            groups.setdefault(label, []).append(val)

        def _apply(vals):
            if not vals:
                return None
            if agg == "sum":
                return round(sum(vals), 4)
            if agg == "max":
                return round(max(vals), 4)
            if agg == "min":
                return round(min(vals), 4)
            if agg == "count":
                return len(vals)
            if agg == "distinct":
                return len(set(vals))
            return round(sum(vals) / len(vals), 4)  # avg

        out = []
        for label, vals in groups.items():
            out.append({
                "name": label if group_by else (metric_name or "all"),
                "value": _apply(vals),
                "count": len(vals),
            })

        return {
            "status": "ok",
            "tenant_id": tenant_id,
            "metric_name": metric_name,
            "group_by": group_by,
            "agg": agg,
            "count": len(out),
            "data": out,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# HITL (Human-In-The-Loop) Endpoints
# ──────────────────────────────────────────────


class HITLConfigRequest(BaseModel):
    tenant_id: str
    settings: dict


@app.get("/hitl/config/{tenant_id}")
async def get_hitl_config(tenant_id: str):
    """Fetch the HITL configuration for a given tenant."""
    try:
        config = fetch_hitl_config(tenant_id)
        return {"status": "ok", "config": config}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/hitl/config")
async def save_hitl_config(request: HITLConfigRequest):
    """Save the HITL configuration to the tasks row in Supabase."""
    try:
        SUPABASE_KEY = os.getenv("SUPADB_API")
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")

        if not rest_url or not SUPABASE_KEY:
            return {"status": "error", "message": "Database not configured"}

        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }

        # First, check if a tasks row already exists for this tenant
        query_url = f"{rest_url}?filename=eq.tasks&datatype=eq.tasks&tenant_id=eq.{request.tenant_id}&select=id"
        check_response = requests.get(query_url, headers=headers, timeout=10)

        existing_id = None
        if check_response.status_code == 200:
            rows = check_response.json()
            if rows:
                existing_id = rows[0].get("id")

        if existing_id:
            # Update the existing row
            # First fetch existing data to merge — this preserves task definitions
            # that are stored in the same row alongside HITL settings.
            fetch_response = requests.get(
                f"{rest_url}?id=eq.{existing_id}&select=data",
                headers=headers,
                timeout=10,
            )
            existing_data = {}
            if fetch_response.status_code == 200:
                existing_rows = fetch_response.json()
                if existing_rows:
                    raw = existing_rows[0].get("data", {})
                    if isinstance(raw, str):
                        try:
                            existing_data = json.loads(raw)
                        except json.JSONDecodeError:
                            existing_data = {}
                    elif isinstance(raw, dict):
                        existing_data = raw

            # Merge HITL settings into the existing data, preserving everything else
            if isinstance(existing_data, dict):
                existing_data["settings"] = request.settings
            else:
                existing_data = {"settings": request.settings}

            payload = {"data": existing_data}
            response = requests.patch(
                f"{rest_url}?id=eq.{existing_id}",
                json=payload,
                headers=headers,
                timeout=10,
            )
        else:
            # Insert a new row
            payload.update({
                "datatype": "tasks",
                "filename": "tasks",
                "tenant_id": request.tenant_id,
            })
            response = requests.post(rest_url, json=payload, headers=headers, timeout=10)

        if response.status_code in [200, 201, 204]:
            return {"status": "ok", "message": "HITL configuration saved successfully."}
        else:
            return {"status": "error", "message": f"Failed to save: {response.text}"}

    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/hitl/task-names/{tenant_id}")
async def get_hitl_task_names(tenant_id: str):
    """Fetch the list of task names from the tasks array for dropdown selection."""
    try:
        names = fetch_task_names(tenant_id)
        return {"status": "ok", "task_names": names}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/hitl/evaluate")
async def hitl_evaluate(data: dict):
    """Evaluate a tool call against HITL rules without executing it."""
    try:
        task_name = data.get("task_name", data.get("task_id", ""))
        tool_args = data.get("tool_args", {})
        user_input = data.get("user_input", "")
        tenant_id = data.get("tenant_id")
        confidence = data.get("confidence")

        decision = evaluate_hitl(
            task_name=task_name,
            tool_args=tool_args,
            confidence=confidence,
            user_input=user_input,
            tenant_id=tenant_id,
        )

        return {"status": "ok", "decision": decision.to_dict()}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/hitl/sentiment")
async def hitl_sentiment(data: dict):
    """Analyze sentiment of a text input."""
    try:
        text = data.get("text", "")
        sentiment = detect_sentiment(text)
        return {"status": "ok", "sentiment": sentiment}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/telemetry/data/{tenant_id}")
async def get_telemetry_data(tenant_id: str):
    """
    Query telemetry data from Supabase for a given tenant.

    Returns events, metrics, and evaluations stored for the tenant.
    """
    try:
        SUPABASE_URL = os.getenv("SUPABASE_URL", "https://vcqfplrdymwfisbekokp.supabase.co")
        SUPABASE_KEY = os.getenv("SUPADB_API")
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")

        if not rest_url or not SUPABASE_KEY:
            return {"status": "error", "message": "Database not configured"}

        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }

        events = []
        metrics = []
        evaluations = []

        # Fetch telemetry events
        try:
            events_resp = requests.get(
                f"{rest_url}?datatype=eq.telemetry_events&tenant_id=eq.{tenant_id}&order=timestamp.desc&limit=100",
                headers=headers,
                timeout=10,
            )
            if events_resp.status_code == 200:
                events = [r.get("data", {}) for r in events_resp.json()]
        except Exception:
            pass

        # Fetch telemetry metrics
        try:
            metrics_resp = requests.get(
                f"{rest_url}?datatype=eq.telemetry_metrics&tenant_id=eq.{tenant_id}&order=timestamp.desc&limit=100",
                headers=headers,
                timeout=10,
            )
            if metrics_resp.status_code == 200:
                metrics = [r.get("data", {}) for r in metrics_resp.json()]
        except Exception:
            pass

        # Fetch telemetry evaluations
        try:
            evals_resp = requests.get(
                f"{rest_url}?datatype=eq.telemetry_evaluations&tenant_id=eq.{tenant_id}&order=timestamp.desc&limit=100",
                headers=headers,
                timeout=10,
            )
            if evals_resp.status_code == 200:
                evaluations = [r.get("data", {}) for r in evals_resp.json()]
        except Exception:
            pass

        return {
            "status": "ok",
            "events": events,
            "metrics": metrics,
            "evaluations": evaluations,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ──────────────────────────────────────────────
# Dashboard Widget Endpoints
# ──────────────────────────────────────────────

class DashboardLayoutRequest(BaseModel):
    layout: list  # list of widget configs with positions


@app.get("/dashboard/layout/{tenant_id}")
async def get_dashboard_layout(tenant_id: str):
    """
    Fetch the saved dashboard widget layout for a given tenant.
    Returns the layout list, or an empty list if no layout is saved yet.
    """
    try:
        SUPABASE_KEY = os.getenv("SUPADB_API")
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")

        if not rest_url or not SUPABASE_KEY:
            return {"status": "error", "message": "Database not configured"}

        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }

        query_url = f"{rest_url}?datatype=eq.dashboard_config&tenant_id=eq.{tenant_id}"
        response = requests.get(query_url, headers=headers, timeout=10)

        if response.status_code == 200:
            rows = response.json()
            if rows:
                raw = rows[0].get("data", {})
                if isinstance(raw, str):
                    try:
                        raw = json.loads(raw)
                    except json.JSONDecodeError:
                        raw = {"layout": []}
                return {"status": "ok", "layout": raw.get("layout", []), "version": raw.get("version", 1)}

        return {"status": "ok", "layout": [], "version": 1}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/dashboard/layout/{tenant_id}")
async def save_dashboard_layout(tenant_id: str, request: DashboardLayoutRequest):
    """
    Save (upsert) the dashboard widget layout for a given tenant.
    Stores in the customer-service-provider table with datatype='dashboard_config'.
    """
    try:
        SUPABASE_KEY = os.getenv("SUPADB_API")
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")

        if not rest_url or not SUPABASE_KEY:
            return {"status": "error", "message": "Database not configured"}

        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

        payload = {
            "datatype": "dashboard_config",
            "filename": "dashboard_config",
            "tenant_id": tenant_id,
            "data": {"tenant_id": tenant_id, "layout": request.layout, "version": 1},
        }

        # Try insert first
        response = requests.post(rest_url, json=payload, headers=headers, timeout=10)

        if response.status_code in (200, 201):
            return {"status": "ok", "message": "Dashboard layout saved"}

        # Conflict = row already exists for this tenant, try update
        if response.status_code == 409 or "23505" in response.text or "duplicate" in response.text.lower():
            patch_payload = {"data": payload["data"]}
            patch_response = requests.patch(
                f"{rest_url}?datatype=eq.dashboard_config&tenant_id=eq.{tenant_id}",
                json=patch_payload,
                headers=headers,
                timeout=10,
            )
            if patch_response.status_code in (200, 204):
                return {"status": "ok", "message": "Dashboard layout updated"}
            return {"status": "error", "message": f"Update failed: {patch_response.text}"}

        return {"status": "error", "message": f"Save failed: {response.text}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/dashboard/widget-data/{tenant_id}")
async def get_dashboard_widget_data(tenant_id: str):
    """
    Fetch aggregated metric data for dashboard widgets.
    Pulls from telemetry_metrics, telemetry_events, telemetry_evaluations,
    and conversations tables — returns a dict keyed by data source type.
    """
    try:
        SUPABASE_KEY = os.getenv("SUPADB_API")
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")

        if not rest_url or not SUPABASE_KEY:
            return {"status": "error", "message": "Database not configured"}

        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }

        result: dict = {
            "status": "ok",
            "tenant_id": tenant_id,
            "conversations": [],
            "telemetry_metrics": [],
            "telemetry_events": [],
            "telemetry_evaluations": [],
        }

        # Fetch conversation data
        try:
            resp = requests.get(
                f"{rest_url}?datatype=eq.conversations&tenant_id=eq.{tenant_id}&order=timestamp.desc&limit=500",
                headers=headers, timeout=10,
            )
            if resp.status_code == 200:
                result["conversations"] = [r.get("data", {}) for r in resp.json()]
        except Exception:
            pass

        # Fetch telemetry metrics
        try:
            resp = requests.get(
                f"{rest_url}?datatype=eq.telemetry_metrics&tenant_id=eq.{tenant_id}&order=timestamp.desc&limit=500",
                headers=headers, timeout=10,
            )
            if resp.status_code == 200:
                result["telemetry_metrics"] = [r.get("data", {}) for r in resp.json()]
        except Exception:
            pass

        # Fetch telemetry events
        try:
            resp = requests.get(
                f"{rest_url}?datatype=eq.telemetry_events&tenant_id=eq.{tenant_id}&order=timestamp.desc&limit=500",
                headers=headers, timeout=10,
            )
            if resp.status_code == 200:
                result["telemetry_events"] = [r.get("data", {}) for r in resp.json()]
        except Exception:
            pass

        # Fetch telemetry evaluations
        try:
            resp = requests.get(
                f"{rest_url}?datatype=eq.telemetry_evaluations&tenant_id=eq.{tenant_id}&order=timestamp.desc&limit=100",
                headers=headers, timeout=10,
            )
            if resp.status_code == 200:
                result["telemetry_evaluations"] = [r.get("data", {}) for r in resp.json()]
        except Exception:
            pass

        return result
    except Exception as e:
        return {"status": "error", "message": str(e)}
