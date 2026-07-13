"""
HITL Email Notification Module

Sends email notifications when HITL (Human-In-The-Loop) is triggered.
Uses the tenant's email from Supabase auth's profiles table as the recipient.
"""

import os
import smtplib
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import requests
from typing import Any


SUPABASE_URL = os.getenv("SUPABASE_URL", "https://vcqfplrdymwfisbekokp.supabase.co")
SUPABASE_KEY = os.getenv("SUPADB_API")


def get_tenant_email(tenant_id: str) -> str | None:
    """Fetch the tenant's email from the profiles table in Supabase."""
    if not tenant_id or not SUPABASE_KEY:
        return None

    rest_url = os.getenv("CUSTOMER_SERVICE_PROVIDER")
    if not rest_url:
        return None

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    try:
        # Try profiles table first
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{tenant_id}&select=email",
            headers=headers,
            timeout=10,
        )
        if response.status_code == 200:
            rows = response.json()
            if rows and rows[0].get("email"):
                return rows[0]["email"]
    except Exception as e:
        print(f"[HITL_NOTIFIER] Failed to fetch email from profiles: {e}")

    return None


def send_hitl_email(
    tenant_id: str,
    decision: Any,
    task_name: str,
    reason: str,
    trigger_type: str,
    tool_args: dict | None = None,
) -> bool:
    """Send an email notification about a HITL trigger.

    Uses SMTP configured via environment variables for sending.
    The recipient is the tenant's email from Supabase auth.

    Required env vars for SMTP:
        SMTP_HOST - SMTP server hostname
        SMTP_PORT - SMTP server port (default 587)
        SMTP_USER - SMTP username
        SMTP_PASS - SMTP password
        SMTP_FROM - From email address (optional, defaults to SMTP_USER)
    """
    recipient_email = get_tenant_email(tenant_id)
    if not recipient_email:
        print(f"[HITL_NOTIFIER] No email found for tenant {tenant_id}")
        return False

    smtp_host = os.getenv("SMTP_HOST")
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")

    if not smtp_host or not smtp_user or not smtp_pass:
        print("[HITL_NOTIFIER] SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS env vars.")
        print(f"[HITL_NOTIFIER] Would send email to: {recipient_email}")
        return False

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = os.getenv("SMTP_FROM", smtp_user)

    try:
        # Build email content
        subject = f"[HITL Alert] Human approval needed for '{task_name}'"
        
        body = f"""
Human-In-The-Loop Notification
===============================

Task: {task_name}
Trigger Type: {trigger_type}
Reason: {reason}

Details:
- Tenant ID: {tenant_id}
- Recipient: {recipient_email}

--- Tool Arguments ---
{json.dumps(tool_args or {}, indent=2)}

---
This action requires your approval. Please review in the dashboard.
"""

        # Build HTML version
        html_body = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 24px; border: 1px solid #e9ecef;">
    <h2 style="color: #dc2626; margin-top: 0;">⚠️ Human Approval Required</h2>
    
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 8px; font-weight: bold; color: #6b7280;">Task</td>
        <td style="padding: 8px;"><code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px;">{task_name}</code></td>
      </tr>
      <tr>
        <td style="padding: 8px; font-weight: bold; color: #6b7280;">Trigger Type</td>
        <td style="padding: 8px;">
          <span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">
            {trigger_type.upper()}
          </span>
        </td>
      </tr>
      <tr>
        <td style="padding: 8px; font-weight: bold; color: #6b7280;">Reason</td>
        <td style="padding: 8px;">{reason}</td>
      </tr>
    </table>

    <h3 style="color: #374151;">Tool Arguments</h3>
    <pre style="background: #1f2937; color: #e5e7eb; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto;">
{json.dumps(tool_args or {}, indent=2)}
    </pre>

    <p style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
      Please review and approve/reject this action in the dashboard.
    </p>
  </div>
</body>
</html>
"""

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = smtp_from
        msg["To"] = recipient_email
        msg["X-Priority"] = "1"  # High priority

        msg.attach(MIMEText(body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, [recipient_email], msg.as_string())

        print(f"[HITL_NOTIFIER] Email sent to {recipient_email} for '{task_name}'")
        return True

    except Exception as e:
        print(f"[HITL_NOTIFIER] Failed to send email: {e}")
        return False


def notify_hitl_triggered(
    tenant_id: str,
    decision: Any,
    tool_name: str,
    tool_args: dict | None = None,
) -> bool:
    """Send notifications for a HITL trigger based on configured channels.

    Currently supports: email (SMTP)
    """
    if not tenant_id:
        return False

    # Get HITL config to check which channels are enabled
    from hitl import fetch_hitl_config
    config = fetch_hitl_config(tenant_id)
    channels = config.get("global_defaults", {}).get("notifications", {}).get("channels", [])
    alert_on_fail = config.get("global_defaults", {}).get("notifications", {}).get("alert_on_fail", True)

    reason = getattr(decision, "reason", "Unknown reason")
    trigger_type = getattr(decision, "trigger_type", "unknown")

    success = True

    if "email" in channels:
        email_ok = send_hitl_email(
            tenant_id=tenant_id,
            decision=decision,
            task_name=tool_name,
            reason=reason,
            trigger_type=trigger_type,
            tool_args=tool_args,
        )
        if not email_ok and alert_on_fail:
            print(f"[HITL_NOTIFIER] Email notification failed for tenant {tenant_id}")
            success = False

    return success