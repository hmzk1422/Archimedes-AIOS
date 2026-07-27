import os
import json
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from gemini import ask_agent, get_retrievers_for_tenant, preprocess, delete_knowledge_file
from telemetry_sdk import get_telemetry, reset_telemetry
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
        # Pass the heavy lifting to a background thread
        background_tasks.add_task(
            preprocess,
            tenant_id=request.tenant_id,
            datatype_label=request.datatype
        )
        # Immediately return success to the client/n8n
        return {"status": "ok", "message": "Ingestion started in the background"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/chat")
async def chat_endpoint(data: dict):
    try:
        user_input = data.get("message")
        tenant_id = data.get("tenant_id")
        customer_id = data.get("customer_id")

        if not user_input:
            return {"status": "error", "message": "No message provided"}

        # Instantly builds retrievers without running heavy pipeline tasks
        retrievers = get_retrievers_for_tenant(tenant_id)
        result = ask_agent(user_input, retrievers, tenant_id, customer_id)

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

        if not user_input:
            return {"status": "error", "message": "No message provided"}

        retrievers = get_retrievers_for_tenant(tenant_id)
        result = ask_agent(user_input, retrievers, tenant_id, customer_id)

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

        # Build the payload — merge settings into existing data if present
        payload = {
            "data": {
                "settings": request.settings
            }
        }

        if existing_id:
            # Update the existing row
            update_url = f"{rest_url}?id=eq.{existing_id}"
            # First fetch existing data to merge
            fetch_response = requests.get(
                f"{rest_url}?id=eq.{existing_id}&select=data",
                headers=headers,
                timeout=10,
            )
            if fetch_response.status_code == 200:
                existing_rows = fetch_response.json()
                if existing_rows:
                    existing_data = existing_rows[0].get("data", {})
                    if isinstance(existing_data, str):
                        try:
                            existing_data = json.loads(existing_data)
                        except json.JSONDecodeError:
                            existing_data = {}
                    if isinstance(existing_data, dict):
                        # Merge settings into existing data
                        existing_data["settings"] = request.settings
                        payload["data"] = existing_data

            response = requests.patch(update_url, json=payload, headers=headers, timeout=10)
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
