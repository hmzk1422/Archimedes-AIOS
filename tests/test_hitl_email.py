"""
Simple test to verify HITL email notifications are working for Allianz account.
This test mocks the SMTP server to avoid sending real emails during testing.
"""

import os
import sys
import json
from unittest.mock import patch, MagicMock

# Load environment variables BEFORE importing api modules,
# so that SUPABASE_KEY and other env vars are available at import time.
# This must happen before the `from hitl import ...` and
# `from hitl_notifier import ...` statements below.
from dotenv import load_dotenv

_ENV_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "api",
    ".env",
)
load_dotenv(_ENV_PATH, override=True)

# Add api directory to path for imports
API_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'api')
sys.path.insert(0, API_DIR)

from hitl import evaluate_hitl, HITLDecision
from hitl_notifier import send_hitl_email, notify_hitl_triggered, get_tenant_email

# Mock config mimicking what Supabase returns for Allianz tenant
MOCK_HITL_CONFIG = {
    "version": "1.0",
    "global_defaults": {
        "response_gating": {
            "confidence_threshold": 0.85,
            "sentiment_escalation": ["negative", "angry"],
            "auto_approve_safe_responses": True,
        },
        "notifications": {
            "channels": ["dashboard", "email"],
            "alert_on_fail": True,
        },
    },
    "task_policies": [
        {
            "name": "process_refund",
            "require_hitl": True,
            "conditions": {
                "amount_threshold": 50.00,
                "requires_sentiment_check": True,
            },
            "description": "High-risk financial action",
        },
        {
            "name": "update_beneficiary",
            "require_hitl": True,
            "conditions": {
                "amount_threshold": None,
                "requires_sentiment_check": True,
            },
            "description": "Beneficiary modification",
        },
        {
            "name": "general_query",
            "require_hitl": False,
            "conditions": {},
            "description": "Routine enquiries",
        },
    ],
}


def _mock_fetch_hitl_config(tenant_id=None):
    """Return the mock HITL config regardless of tenant_id."""
    return MOCK_HITL_CONFIG


def test_hitl_email_configuration():
    """Test that SMTP environment variables are properly configured for Allianz."""
    print("\n=== Testing HITL Email Configuration ===")

    smtp_host = os.getenv("SMTP_HOST")
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_from = os.getenv("SMTP_FROM")

    print(f"SMTP_HOST: {smtp_host}")
    print(f"SMTP_USER: {smtp_user}")
    print(f"SMTP_FROM: {smtp_from}")

    assert smtp_host == "smtp.gmail.com", f"Expected smtp.gmail.com, got {smtp_host}"
    assert smtp_user == "hamazaki.ethanlin@gmail.com", (
        f"Expected hamazaki.ethanlin@gmail.com, got {smtp_user}"
    )
    assert smtp_from == "hamazaki.ethanlin@gmail.com", (
        f"Expected hamazaki.ethanlin@gmail.com, got {smtp_from}"
    )
    assert smtp_pass, "SMTP_PASS must be set"

    print("✅ SMTP configuration is correct for Allianz account")


def test_hitl_evaluation_triggers():
    """Test that HITL evaluation correctly identifies when approval is needed."""
    print("\n=== Testing HITL Evaluation Logic ===")

    # Patch fetch_hitl_config so evaluate_hitl uses our mock config
    # instead of making real HTTP requests to Supabase.
    with patch("hitl.fetch_hitl_config", side_effect=_mock_fetch_hitl_config):
        # Test 1: Action-based trigger (amount > threshold of 50)
        decision = evaluate_hitl(
            task_name="process_refund",
            tool_args={"amount": 100.00},
            confidence=0.95,
            tenant_id="hamazaki-test",
        )
        assert decision.requires_hitl is True, (
            "Should require HITL for amount > threshold"
        )
        assert decision.trigger_type == "action"
        print(f"✅ Action-based trigger works: {decision.reason}")

        # Test 2: Response-based trigger (confidence < 0.85)
        # process_refund requires HITL, amount (10) is below threshold (50),
        # no user_input so no context check — but low confidence (0.70)
        # should still trigger a response-based HITL decision.
        decision = evaluate_hitl(
            task_name="process_refund",
            tool_args={"amount": 10.00},
            confidence=0.70,
            tenant_id="hamazaki-test",
        )
        assert decision.requires_hitl is True, (
            "Should require HITL for low confidence"
        )
        assert decision.trigger_type == "response"
        print(f"✅ Response-based trigger works: {decision.reason}")

        # Test 3: Context-based trigger (angry sentiment)
        decision = evaluate_hitl(
            task_name="update_beneficiary",
            tool_args={},
            confidence=0.95,
            user_input="I am furious about this service!",
            tenant_id="hamazaki-test",
        )
        assert decision.requires_hitl is True, (
            "Should require HITL for angry sentiment"
        )
        assert decision.trigger_type == "context"
        print(f"✅ Context-based trigger works: {decision.reason}")


def test_email_notification_mock():
    """Test that email notification is triggered with mocked SMTP."""
    print("\n=== Testing Email Notification (Mocked) ===")

    # Mock the SMTP server to avoid actually sending emails.
    # Also mock get_tenant_email so send_hitl_email has a recipient,
    # and mock fetch_hitl_config so notify_hitl_triggered gets our
    # mock config with "email" channel enabled.
    with patch("hitl_notifier.smtplib.SMTP") as mock_smtp, \
         patch("hitl_notifier.get_tenant_email",
               return_value="hamazaki.ethanlin@gmail.com") as mock_email, \
         patch("hitl.fetch_hitl_config",
               side_effect=_mock_fetch_hitl_config):

        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        decision = HITLDecision(
            requires_hitl=True,
            reason="Test trigger",
            trigger_type="action",
            task_name="process_refund",
        )

        result = notify_hitl_triggered(
            tenant_id="hamazaki-test",
            decision=decision,
            tool_name="process_refund",
            tool_args={"amount": 100.00},
        )

        assert result is True, "notify_hitl_triggered should return True on success"

        # Verify SMTP sendmail was called
        assert mock_server.sendmail.called, (
            "SMTP sendmail should have been called"
        )

        call_args = mock_server.sendmail.call_args
        sent_from = call_args[0][0]
        sent_to = call_args[0][1]
        email_content = call_args[0][2]

        print("✅ Email notification triggered")
        print(f"   From: {sent_from}")
        print(f"   To: {sent_to}")

        subject_parts = email_content.split("Subject: ")
        subject_line = (
            subject_parts[1].split("\n")[0]
            if len(subject_parts) > 1
            else "N/A"
        )
        print(f"   Subject: {subject_line}")

        assert "hamazaki.ethanlin@gmail.com" in sent_to, (
            f"Recipient should be hamazaki.ethanlin@gmail.com, got {sent_to}"
        )
        assert "[HITL Alert]" in email_content, (
            "Email content should contain [HITL Alert] in subject"
        )
        assert "process_refund" in email_content, (
            "Email content should mention the task name"
        )

        # Verify that get_tenant_email was called with the right tenant
        mock_email.assert_called_once_with("hamazaki-test")


def test_tenant_email_lookup_success():
    """Test that the tenant email lookup function correctly retrieves an email
    when Supabase returns a valid response.
    """
    print("\n=== Testing Tenant Email Lookup (Success Path) ===")

    # Patch SUPABASE_KEY (which is set at import time) so the early guard
    # passes even if .env wasn't loaded when the module was first imported.
    with patch("hitl_notifier.SUPABASE_KEY", "test-key"), \
         patch.dict(os.environ, {
             "CUSTOMER_SERVICE_PROVIDER":
                 "https://example.supabase.co/rest/v1"
         }):

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {"email": "hamazaki.ethanlin@gmail.com"}
        ]

        with patch(
            "hitl_notifier.requests.get", return_value=mock_response
        ):
            email = get_tenant_email("hamazaki-test")
            print(f"✅ Tenant email lookup with mock returns: {email}")
            assert email == "hamazaki.ethanlin@gmail.com", (
                f"Expected hamazaki.ethanlin@gmail.com, got {email}"
            )


def test_tenant_email_lookup_error():
    """Test that tenant email lookup handles errors gracefully."""
    print("\n=== Testing Tenant Email Lookup (Error Handling) ===")

    with patch("hitl_notifier.SUPABASE_KEY", "test-key"), \
         patch.dict(os.environ, {
             "CUSTOMER_SERVICE_PROVIDER":
                 "https://example.supabase.co/rest/v1"
         }):

        with patch(
            "hitl_notifier.requests.get",
            side_effect=Exception("Connection error"),
        ):
            email = get_tenant_email("hamazaki-test")
            print(
                f"✅ Tenant email lookup handles errors gracefully "
                f"(returned: {email})"
            )
            assert email is None, "Should return None on error"


if __name__ == "__main__":
    print("=" * 60)
    print("HITL Email Notification System Test")
    print("=" * 60)

    try:
        test_hitl_email_configuration()
        test_hitl_evaluation_triggers()
        test_email_notification_mock()
        test_tenant_email_lookup_success()
        test_tenant_email_lookup_error()

        print("\n" + "=" * 60)
        print("✅ All HITL email tests passed!")
        print("=" * 60)
        print("\nThe HITL email notification system is configured and working.")
        print(
            "When a HITL trigger fires, emails will be sent to "
            "hamazaki.ethanlin@gmail.com"
        )
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)