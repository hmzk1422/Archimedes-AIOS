"""
Human-In-The-Loop (HITL) Evaluation Engine

Three trigger types:
1. Action-Based (Deterministic)  — If Action == [Sensitive] OR Value > [Threshold]
2. Response-Based (Probabilistic) — If Confidence < [Threshold]
3. Context-Based (Heuristic)      — If Sentiment == [Negative/Angry]

Configuration is stored in the 'tasks' row of the customer-service-provider table
under the 'settings' key. The schema:

{
  "settings": {
    "version": "1.0",
    "global_defaults": {
      "response_gating": {
        "confidence_threshold": 0.85,
        "sentiment_escalation": ["negative", "angry"],
        "auto_approve_safe_responses": true
      },
      "notifications": {
        "channels": ["dashboard", "slack"],
        "alert_on_fail": true
      }
    },
    "task_policies": [
      {
        "name": "process_refund",
        "require_hitl": true,
        "conditions": {
          "amount_threshold": 50.00,
          "requires_sentiment_check": true
        },
        "description": "High-risk financial action"
      }
    ]
  }
}
"""

import os
import json
import re
import requests
from typing import Any

# ──────────────────────────────────────────────
# 1. Configuration Loader
# ──────────────────────────────────────────────

DEFAULT_HITL_CONFIG = {
    "version": "1.0",
    "global_defaults": {
        "response_gating": {
            "confidence_threshold": 0.85,
            "sentiment_escalation": ["negative", "angry"],
            "auto_approve_safe_responses": True,
        },
        "notifications": {
            "channels": ["dashboard"],
            "alert_on_fail": True,
        },
    },
    "task_policies": [],
}


def fetch_hitl_config(tenant_id: str | None = None) -> dict:
    """Fetch the HITL settings from the tasks row in Supabase.

    Returns the full settings dict, falling back to defaults if none exist.
    """
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    if not rest_url:
        return dict(DEFAULT_HITL_CONFIG)

    query_url = f"{rest_url}?filename=eq.tasks&datatype=eq.tasks&select=data"
    if tenant_id:
        query_url += f"&tenant_id=eq.{tenant_id}"

    headers = {
        "apikey": os.getenv("SUPADB_API"),
        "Authorization": f"Bearer {os.getenv('SUPADB_API')}",
    }

    try:
        response = requests.get(query_url, headers=headers, timeout=10)
        if response.status_code == 200:
            rows = response.json()
            if rows:
                raw_data = rows[0].get("data", {})
                # The data might be a string or a dict
                if isinstance(raw_data, str):
                    try:
                        raw_data = json.loads(raw_data)
                    except json.JSONDecodeError:
                        pass

                # Extract settings from the data
                if isinstance(raw_data, dict):
                    settings = raw_data.get("settings", {})
                    if settings:
                        return _merge_with_defaults(settings)
    except Exception as e:
        print(f"[HITL] Failed to fetch config: {e}")

    return dict(DEFAULT_HITL_CONFIG)


def fetch_task_names(tenant_id: str | None = None) -> list[str]:
    """Fetch the list of task names from the tasks array in the database.

    This lets the HITL UI show a dropdown of existing task names for setting policies.
    """
    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    if not rest_url:
        return []

    query_url = f"{rest_url}?filename=eq.tasks&datatype=eq.tasks&select=data"
    if tenant_id:
        query_url += f"&tenant_id=eq.{tenant_id}"

    headers = {
        "apikey": os.getenv("SUPADB_API"),
        "Authorization": f"Bearer {os.getenv('SUPADB_API')}",
    }

    try:
        response = requests.get(query_url, headers=headers, timeout=10)
        if response.status_code == 200:
            rows = response.json()
            if rows:
                raw_data = rows[0].get("data", {})
                if isinstance(raw_data, str):
                    try:
                        raw_data = json.loads(raw_data)
                    except json.JSONDecodeError:
                        return []

                if isinstance(raw_data, dict):
                    tasks = raw_data.get("tasks", [])
                    if isinstance(tasks, list):
                        return [t.get("name", "") for t in tasks if t.get("name")]

    except Exception as e:
        print(f"[HITL] Failed to fetch task names: {e}")

    return []


def _merge_with_defaults(settings: dict) -> dict:
    """Merge user settings with defaults so missing keys fall back safely."""
    merged = dict(DEFAULT_HITL_CONFIG)
    merged.update(settings)

    # Deep-merge global_defaults
    if "global_defaults" in settings:
        gd = merged["global_defaults"]
        incoming_gd = settings["global_defaults"]
        if "response_gating" in incoming_gd:
            gd["response_gating"].update(incoming_gd["response_gating"])
        if "notifications" in incoming_gd:
            gd["notifications"].update(incoming_gd["notifications"])

    # task_policies is a list — just take what the user provided
    if "task_policies" in settings:
        merged["task_policies"] = settings["task_policies"]

    return merged


# ──────────────────────────────────────────────
# 2. Trigger Evaluators
# ──────────────────────────────────────────────

class HITLDecision:
    """Represents the result of a HITL evaluation."""

    def __init__(
        self,
        requires_hitl: bool = False,
        reason: str | None = None,
        trigger_type: str | None = None,
        confidence: float | None = None,
        sentiment: str | None = None,
        task_name: str | None = None,
    ):
        self.requires_hitl = requires_hitl
        self.reason = reason
        self.trigger_type = trigger_type  # "action", "response", "context"
        self.confidence = confidence
        self.sentiment = sentiment
        self.task_name = task_name

    def to_dict(self) -> dict:
        return {
            "requires_hitl": self.requires_hitl,
            "reason": self.reason,
            "trigger_type": self.trigger_type,
            "confidence": self.confidence,
            "sentiment": self.sentiment,
            "task_name": self.task_name,
        }

    def __repr__(self):
        return f"HITLDecision(requires_hitl={self.requires_hitl}, reason={self.reason})"


def evaluate_action_based(
    task_name: str,
    tool_args: dict[str, Any],
    task_policy: dict | None,
    global_defaults: dict,
) -> HITLDecision:
    """Action-Based (Deterministic) trigger.

    Checks:
    - If the task is marked as always requiring HITL
    - If any argument value exceeds a configured threshold (e.g. amount > $50)
    """
    if not task_policy:
        return HITLDecision(requires_hitl=False)

    # Always-require check
    conditions = task_policy.get("conditions", {})
    if conditions.get("always_require"):
        return HITLDecision(
            requires_hitl=True,
            reason=f"Task '{task_name}' is configured to always require human approval.",
            trigger_type="action",
            task_name=task_name,
        )

    # Threshold check — look for numeric args that exceed configured thresholds
    amount_threshold = conditions.get("amount_threshold")
    if amount_threshold is not None:
        for arg_name, arg_value in tool_args.items():
            # Try to extract a numeric value from the arg
            numeric_value = _extract_numeric(arg_value)
            if numeric_value is not None and numeric_value > amount_threshold:
                return HITLDecision(
                    requires_hitl=True,
                    reason=f"Argument '{arg_name}' value ({numeric_value}) exceeds threshold ({amount_threshold}).",
                    trigger_type="action",
                    task_name=task_name,
                )

    return HITLDecision(requires_hitl=False)


def _extract_numeric(value: Any) -> float | None:
    """Try to extract a numeric value from various types."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        # Remove currency symbols and commas
        cleaned = re.sub(r'[$€£¥,\s]', '', value.strip())
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def evaluate_response_based(
    confidence: float | None,
    global_defaults: dict,
    task_name: str | None = None,
) -> HITLDecision:
    """Response-Based (Probabilistic) trigger.

    Checks if the AI's confidence in its response is below the threshold.
    """
    if confidence is None:
        return HITLDecision(requires_hitl=False)

    threshold = global_defaults.get("response_gating", {}).get("confidence_threshold", 0.85)

    if confidence < threshold:
        return HITLDecision(
            requires_hitl=True,
            reason=f"AI confidence ({confidence:.2f}) is below threshold ({threshold}).",
            trigger_type="response",
            confidence=confidence,
            task_name=task_name,
        )

    return HITLDecision(requires_hitl=False)


def evaluate_context_based(
    sentiment: str | None,
    global_defaults: dict,
    task_name: str | None = None,
) -> HITLDecision:
    """Context-Based (Heuristic) trigger.

    Checks if the detected customer sentiment is in the escalation list.
    """
    if not sentiment:
        return HITLDecision(requires_hitl=False)

    escalation_list = global_defaults.get("response_gating", {}).get(
        "sentiment_escalation", ["negative", "angry"]
    )
    sentiment_lower = sentiment.lower().strip()

    if sentiment_lower in [s.lower() for s in escalation_list]:
        return HITLDecision(
            requires_hitl=True,
            reason=f"Customer sentiment '{sentiment}' requires human escalation.",
            trigger_type="context",
            sentiment=sentiment,
            task_name=task_name,
        )

    return HITLDecision(requires_hitl=False)


# ──────────────────────────────────────────────
# 3. Sentiment Analysis (Lightweight)
# ──────────────────────────────────────────────

# Simple keyword-based sentiment classifier
_SENTIMENT_KEYWORDS = {
    "positive": [
        "thank", "great", "awesome", "perfect", "happy", "pleased",
        "satisfied", "wonderful", "excellent", "good", "love", "appreciate",
    ],
    "negative": [
        "bad", "terrible", "awful", "horrible", "worst", "hate", "disappointed",
        "unhappy", "frustrated", "annoyed", "poor", "useless", "broken",
    ],
    "angry": [
        "angry", "furious", "outraged", "livid", "infuriated", "mad",
        "rage", "fuming", "irate", "frustrating", "unacceptable",
    ],
    "neutral": [],
}


def detect_sentiment(text: str) -> str:
    """Detect sentiment from text using keyword matching.

    Returns one of: 'positive', 'negative', 'angry', 'neutral'
    """
    if not text:
        return "neutral"

    text_lower = text.lower()

    # Check angry first (strongest signal)
    angry_score = sum(1 for kw in _SENTIMENT_KEYWORDS["angry"] if kw in text_lower)
    negative_score = sum(1 for kw in _SENTIMENT_KEYWORDS["negative"] if kw in text_lower)
    positive_score = sum(1 for kw in _SENTIMENT_KEYWORDS["positive"] if kw in text_lower)

    if angry_score > 0:
        return "angry"
    if negative_score > positive_score:
        return "negative"
    if positive_score > 0:
        return "positive"

    return "neutral"


# ──────────────────────────────────────────────
# 4. Main Evaluation Entry Point
# ──────────────────────────────────────────────

def evaluate_hitl(
    task_name: str,
    tool_args: dict[str, Any] | None = None,
    confidence: float | None = None,
    user_input: str | None = None,
    tenant_id: str | None = None,
) -> HITLDecision:
    """Evaluate all HITL triggers and return the final decision.

    Args:
        task_name: The name of the task being executed (matches the 'name' field
                   in the tasks array).
        tool_args: Arguments being passed to the tool.
        confidence: AI's confidence score (0.0 to 1.0).
        user_input: The original user message (for sentiment analysis).
        tenant_id: Tenant scope for fetching config.

    Returns:
        HITLDecision with requires_hitl=True if any trigger fires.
    """
    config = fetch_hitl_config(tenant_id)
    global_defaults = config.get("global_defaults", {})
    task_policies = config.get("task_policies", [])

    # Find the matching task policy
    task_policy = None
    for policy in task_policies:
        if policy.get("name") == task_name:
            task_policy = policy
            break

    # If the task has no policy, check if it should auto-approve
    if not task_policy:
        auto_approve = global_defaults.get("response_gating", {}).get(
            "auto_approve_safe_responses", True
        )
        if auto_approve:
            return HITLDecision(requires_hitl=False)
        # If not auto-approving, we still let it pass (no policy = no restriction)
        return HITLDecision(requires_hitl=False)

    # If the task explicitly does NOT require HITL, skip
    if not task_policy.get("require_hitl", True):
        return HITLDecision(requires_hitl=False)

    # 1. Action-Based Check
    action_decision = evaluate_action_based(
        task_name, tool_args or {}, task_policy, global_defaults
    )
    if action_decision.requires_hitl:
        return action_decision

    # 2. Context-Based Check (sentiment)
    if user_input and task_policy.get("conditions", {}).get("requires_sentiment_check"):
        sentiment = detect_sentiment(user_input)
        context_decision = evaluate_context_based(
            sentiment, global_defaults, task_name
        )
        if context_decision.requires_hitl:
            return context_decision

    # 3. Response-Based Check (confidence)
    response_decision = evaluate_response_based(confidence, global_defaults, task_name)
    if response_decision.requires_hitl:
        return response_decision

    return HITLDecision(requires_hitl=False)