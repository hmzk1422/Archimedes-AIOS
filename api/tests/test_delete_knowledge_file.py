import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import gemini


def test_delete_knowledge_file_strips_extension_and_matches_db_rows(monkeypatch):
    calls = []

    class Response:
        def __init__(self, status_code=200, payload=None):
            self.status_code = status_code
            self._payload = payload or []

        def json(self):
            return self._payload

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError("boom")

    def fake_get(url, headers=None, timeout=10):
        if "/rest/v1/documents" in url:
            return Response(200, [{"id": "doc-1", "metadata": {"tenant_id": "tenant-123", "datatype": "policies", "source": "sample"}}])
        return Response(200, [{"id": "row-1"}])

    def fake_delete(url, headers=None, timeout=10):
        calls.append(url)
        return Response(204, [])

    monkeypatch.setenv("CUSTOMER_SERVICE_PROVIDER", "https://example.supabase.co/rest/v1/customer-service-provider")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPADB_API", "token")
    monkeypatch.setattr(gemini.requests, "get", fake_get)
    monkeypatch.setattr(gemini.requests, "delete", fake_delete)

    result = gemini.delete_knowledge_file("tenant-123", "policies", "sample.pdf")

    assert result["deleted_rows"] == 1
    assert result["deleted_documents"] == 1
    assert any("filename=eq.sample" in call for call in calls)
    assert any("/rest/v1/documents" in call for call in calls)
