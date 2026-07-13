"""
Relay Telemetry SDK — framework-agnostic observability for AI agents.

Provides a lightweight wrapper around OpenTelemetry that allows users to
push custom Events, Spans, and Metrics into the platform. Fully compatible
with the OpenTelemetry standard so data can be piped into Datadog, New Relic,
Grafana, or any OTLP-compatible backend.

Usage (by the user's agent code):
    from telemetry_sdk import RelayTelemetry

    telemetry = RelayTelemetry(
        service_name="customer-support-agent",
        tenant_id="tenant_abc123",
        otlp_endpoint="http://localhost:4318/v1/traces",  # optional
    )

    # Log a custom event
    telemetry.log("task_completed", {"status": "success", "complexity": "high"})

    # Tag a span with business-specific metadata
    with telemetry.span("process_refund") as span:
        span.set_attribute("refund_amount", 49.99)
        span.set_attribute("customer_tier", "enterprise")
        # ... agent logic ...

    # Record a custom metric (counter / gauge)
    telemetry.metric("conversation_duration_ms", 1234, tags={"channel": "chat"})

    # Attach context to every trace for filtering
    telemetry.set_context({"user_id": "usr_456", "transaction_id": "txn_789"})
"""

import os
import time
import uuid
import json
import threading
from typing import Any, Optional
from contextlib import contextmanager

# OpenTelemetry imports
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes

import requests

# ──────────────────────────────────────────────
# Local Supabase-backed storage (fallback when no OTLP endpoint is configured)
# ──────────────────────────────────────────────

_SUPABASE_URL = os.getenv("SUPABASE_URL", "https://vcqfplrdymwfisbekokp.supabase.co")
_SUPABASE_KEY = os.getenv("SUPADB_API")
_SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "customer-service-provider")
_TABLE_NAME = "customer-service-provider"


def _submit_to_supabase(tenant_id: str, datatype: str, payload: dict) -> None:
    """Persist a telemetry record to Supabase as a JSON row."""
    if not _SUPABASE_KEY:
        return  # silently skip if no DB configured

    try:
        rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
        if not rest_url:
            return

        headers = {
            "apikey": _SUPABASE_KEY,
            "Authorization": f"Bearer {_SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

        body = {
            "datatype": datatype,
            "filename": f"telemetry_{payload.get('event_type', 'unknown')}",
            "data": payload,
            "tenant_id": tenant_id,
        }

        requests.post(rest_url, json=body, headers=headers, timeout=5)
    except Exception:
        pass  # best-effort persistence


# ──────────────────────────────────────────────
# OTLP HTTP Exporter helpers (for piping into Datadog / Grafana / etc.)
# ──────────────────────────────────────────────


def _build_otlp_span_exporter(endpoint: str | None) -> BatchSpanProcessor | None:
    """Build an OTLP span exporter if an OTLP endpoint is configured."""
    if not endpoint:
        return None
    try:
        exporter = OTLPSpanExporter(endpoint=endpoint)
        return BatchSpanProcessor(exporter)
    except Exception:
        return None


def _build_otlp_metric_exporter(endpoint: str | None) -> PeriodicExportingMetricReader | None:
    """Build an OTLP metric exporter if an OTLP endpoint is configured."""
    if not endpoint:
        return None
    try:
        exporter = OTLPMetricExporter(endpoint=endpoint.replace("traces", "metrics"))
        return PeriodicExportingMetricReader(exporter)
    except Exception:
        return None


# ──────────────────────────────────────────────
# The RelayTelemetry class — user-facing SDK
# ──────────────────────────────────────────────


class RelayTelemetry:
    """
    Lightweight telemetry SDK for AI agents.

    Automatically initializes OpenTelemetry providers and exposes
    a simple API for logging events, creating spans, and recording metrics.
    """

    def __init__(
        self,
        service_name: str = "relay-agent",
        tenant_id: str | None = None,
        otlp_endpoint: str | None = None,
        enable_local_storage: bool = True,
    ):
        self.service_name = service_name
        self.tenant_id = tenant_id or os.getenv("RELAY_TENANT_ID", "default")
        self.enable_local_storage = enable_local_storage
        self._context: dict[str, str] = {}

        # Build resource with service metadata
        self.resource = Resource.create({
            ResourceAttributes.SERVICE_NAME: service_name,
            ResourceAttributes.SERVICE_INSTANCE_ID: str(uuid.uuid4()),
            "relay.tenant_id": self.tenant_id,
        })

        # ── Tracer Provider ──
        tracer_provider = TracerProvider(resource=self.resource)
        span_processor = _build_otlp_span_exporter(otlp_endpoint)
        if span_processor:
            tracer_provider.add_span_processor(span_processor)
        trace.set_tracer_provider(tracer_provider)
        self._tracer = trace.get_tracer(service_name)

        # ── Meter Provider ──
        metric_readers: list[PeriodicExportingMetricReader] = []
        otlp_metric_reader = _build_otlp_metric_exporter(otlp_endpoint)
        if otlp_metric_reader:
            metric_readers.append(otlp_metric_reader)

        meter_provider_kwargs = {"resource": self.resource}
        if metric_readers:
            meter_provider_kwargs["metric_readers"] = metric_readers

        meter_provider = MeterProvider(**meter_provider_kwargs)
        metrics.set_meter_provider(meter_provider)
        self._meter = metrics.get_meter_provider().get_meter(service_name)

        # In-memory event store (for the UI dashboard to query)
        self._lock = threading.Lock()
        self._event_log: list[dict[str, Any]] = []

    def set_context(self, context: dict[str, str]) -> None:
        """Set global context attributes that will be attached to every span/event."""
        self._context.update(context)

    def get_context(self) -> dict[str, str]:
        """Return the current context dictionary."""
        return dict(self._context)

    # ── Event Logging ──

    def log(self, event_type: str, attributes: dict[str, Any] | None = None) -> None:
        """
        Log a custom agent event.

        Example:
            telemetry.log("task_completed", {"status": "success", "complexity": "high"})
        """
        span = trace.get_current_span()
        attrs = {**(attributes or {}), **self._context}

        # Add event to current span (if any)
        span.add_event(event_type, attrs)

        # Store in memory for UI
        record = {
            "event_type": event_type,
            "attributes": attrs,
            "timestamp": time.time_ns(),
            "trace_id": format(span.get_span_context().trace_id, "032x") if span.is_recording() else None,
        }
        with self._lock:
            self._event_log.append(record)

        # Persist to Supabase for long-term storage
        if self.enable_local_storage:
            threading.Thread(
                target=_submit_to_supabase,
                args=(self.tenant_id, "telemetry_events", record),
                daemon=True,
            ).start()

    def tag(self, key: str, value: str) -> None:
        """
        Convenience method to attach a single tag/attribute to the current span.

        Example:
            telemetry.tag("customer_tier", "enterprise")
        """
        span = trace.get_current_span()
        if span.is_recording():
            span.set_attribute(key, value)
            span.set_attribute("relay.tenant_id", self.tenant_id)

    # ── Span Context Manager ──

    @contextmanager
    def span(self, name: str, attributes: dict[str, Any] | None = None):
        """
        Create a new span for tracing agent operations.

        Example:
            with telemetry.span("process_refund") as span:
                span.set_attribute("refund_amount", 49.99)
        """
        with self._tracer.start_as_current_span(name) as span:
            if self._context:
                span.set_attributes(self._context)
            if attributes:
                span.set_attributes(attributes)
            span.set_attribute("relay.tenant_id", self.tenant_id)
            yield span

    # ── Metrics ──

    def metric(
        self,
        name: str,
        value: float | int,
        tags: dict[str, str] | None = None,
        metric_type: str = "counter",
    ) -> None:
        """
        Record a custom metric.

        Args:
            name: Metric name (e.g. "conversation_duration_ms")
            value: Numeric value to record
            tags: Optional key-value pairs for filtering
            metric_type: "counter" (incrementing) or "gauge" (current value)

        Example:
            telemetry.metric("conversation_duration_ms", 1234, tags={"channel": "chat"})
        """
        attrs = {**(tags or {}), **self._context}
        attrs["relay.tenant_id"] = self.tenant_id

        try:
            if metric_type == "counter":
                counter = self._meter.create_counter(
                    name=name,
                    description=f"Custom counter: {name}",
                    unit="1",
                )
                counter.add(value, attributes=attrs)
            elif metric_type == "gauge":
                gauge = self._meter.create_histogram(
                    name=name,
                    description=f"Custom gauge: {name}",
                    unit="1",
                )
                gauge.record(value, attributes=attrs)
        except Exception:
            pass  # best-effort metric recording

        # Store in memory
        record = {
            "metric_name": name,
            "metric_type": metric_type,
            "value": value,
            "tags": tags or {},
            "context": self._context,
            "timestamp": time.time_ns(),
        }
        with self._lock:
            self._event_log.append(record)

        if self.enable_local_storage:
            threading.Thread(
                target=_submit_to_supabase,
                args=(self.tenant_id, "telemetry_metrics", record),
                daemon=True,
            ).start()

    # ── Evaluation Recording ──

    def record_evaluation(
        self,
        evaluation_name: str,
        score: float,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """
        Record the result of a custom evaluation / LLM-as-judge test.

        Example:
            telemetry.record_evaluation("faithfulness", 9.5, {"question": "..."})
        """
        record = {
            "evaluation_name": evaluation_name,
            "score": score,
            "metadata": metadata or {},
            "context": self._context,
            "timestamp": time.time_ns(),
        }
        with self._lock:
            self._event_log.append(record)

        if self.enable_local_storage:
            threading.Thread(
                target=_submit_to_supabase,
                args=(self.tenant_id, "telemetry_evaluations", record),
                daemon=True,
            ).start()

    # ── Query stored data (for the UI dashboard) ──

    def get_events(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return the in-memory event log (for debugging / dashboard)."""
        with self._lock:
            return list(self._event_log[-limit:])

    def get_evaluations(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return evaluation records filtered from the event log."""
        with self._lock:
            return [
                e for e in self._event_log[-limit:]
                if "evaluation_name" in e
            ]

    def get_metrics(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return metric records filtered from the event log."""
        with self._lock:
            return [
                e for e in self._event_log[-limit:]
                if "metric_name" in e
            ]

    def shutdown(self) -> None:
        """Gracefully shut down telemetry providers."""
        trace.get_tracer_provider().shutdown()
        metrics.get_meter_provider().shutdown()


# ──────────────────────────────────────────────
# Global singleton registry (for multi-tenant scenarios)
# ──────────────────────────────────────────────

_instances: dict[str, RelayTelemetry] = {}
_instance_lock = threading.Lock()


def get_telemetry(
    service_name: str = "relay-agent",
    tenant_id: str | None = None,
    otlp_endpoint: str | None = None,
) -> RelayTelemetry:
    """
    Get or create a RelayTelemetry instance for the given tenant.

    This ensures each tenant gets its own provider chain, so telemetry
    data stays isolated.
    """
    key = f"{tenant_id or 'default'}:{service_name}"
    with _instance_lock:
        if key not in _instances:
            _instances[key] = RelayTelemetry(
                service_name=service_name,
                tenant_id=tenant_id,
                otlp_endpoint=otlp_endpoint,
            )
        return _instances[key]


def reset_telemetry(tenant_id: str | None = None, service_name: str = "relay-agent") -> None:
    """Remove and shut down a telemetry instance (for cleanup/reinit)."""
    key = f"{tenant_id or 'default'}:{service_name}"
    with _instance_lock:
        inst = _instances.pop(key, None)
        if inst:
            inst.shutdown()