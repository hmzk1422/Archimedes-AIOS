"""
Activepieces Connector Module
=============================
Handles all interactions with a running Activepieces instance via its REST API.

This replaces the n8n workflow approach with Activepieces for Telegram routing.
Works with Activepieces running via npx (no Docker required) to avoid the
Docker freeze issue on this system.

Endpoints covered:
  - Health check / connectivity
  - List flows
  - Deploy / upsert flow from JSON definition
  - Enable / disable flow
  - Delete flow
  - List connections (upserts credentials for Telegram bot token)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()


class ActivepiecesConnector:
    """Thin client around the Activepieces platform REST API."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        flow_definition_path: Optional[str] = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("ACTIVEPIECES_URL", "http://localhost:3001")).rstrip("/")
        self.api_key = api_key or os.getenv("ACTIVEPIECES_API_KEY", "")
        self.flow_definition_path = flow_definition_path or os.path.join(
            os.path.dirname(__file__), "activepieces-flow.json"
        )
        self.timeout = float(os.getenv("ACTIVEPIECES_TIMEOUT", "15"))

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if extra:
            headers.update(extra)
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> httpx.Response:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            return await client.request(
                method,
                url,
                headers=self._headers(),
                json=json_body,
                params=params,
            )

    # ------------------------------------------------------------------
    # 1. Connectivity
    # ------------------------------------------------------------------
    async def health_check(self) -> Dict[str, Any]:
        """Return whether Activepieces is reachable and basic info."""
        try:
            response = await self._request("GET", "/api/health")
            reachable = response.status_code < 500
            return {
                "reachable": reachable,
                "status_code": response.status_code,
                "url": self.base_url,
                "api_key_configured": bool(self.api_key),
                "body": response.text[:500] if not reachable else "ok",
            }
        except Exception as exc:
            return {
                "reachable": False,
                "status_code": None,
                "url": self.base_url,
                "api_key_configured": bool(self.api_key),
                "error": str(exc),
            }

    # ------------------------------------------------------------------
    # 2. Flows
    # ------------------------------------------------------------------
    async def list_flows(self) -> List[Dict[str, Any]]:
        """List all flows in the Activepieces instance."""
        try:
            response = await self._request("GET", "/api/v1/flows")
            if response.status_code == 200:
                data = response.json()
                return data if isinstance(data, list) else data.get("data", [])
            return []
        except Exception as exc:
            print(f"[ActivepiecesConnector] list_flows error: {exc}")
            return []

    async def get_flow(self, flow_id: str) -> Optional[Dict[str, Any]]:
        """Get a single flow by ID."""
        try:
            response = await self._request("GET", f"/api/v1/flows/{flow_id}")
            if response.status_code == 200:
                return response.json()
            return None
        except Exception as exc:
            print(f"[ActivepiecesConnector] get_flow error: {exc}")
            return None

    async def deploy_flow(
        self,
        flow_payload: Optional[Dict[str, Any]] = None,
        *,
        publish: bool = True,
    ) -> Dict[str, Any]:
        """
        Deploy (create or update) a flow from the JSON definition.

        If a flow with the same display name already exists, it is updated;
        otherwise a new flow is created. When ``publish`` is True the flow is
        also enabled so it starts listening for triggers immediately.
        """
        if flow_payload is None:
            flow_payload = self._load_flow_definition()

        # Try to find an existing flow with the same name to upsert
        existing = await self._find_flow_by_name(flow_payload.get("name", ""))
        if existing and existing.get("id"):
            return await self._update_flow(existing["id"], flow_payload, publish=publish)
        return await self._create_flow(flow_payload, publish=publish)

    async def _create_flow(self, flow_payload: Dict[str, Any], *, publish: bool) -> Dict[str, Any]:
        create_body = {
            "displayName": flow_payload.get("name", "Customer Service Flow"),
            "trigger": flow_payload.get("trigger", {}),
            "steps": flow_payload.get("steps", []),
            "connections": flow_payload.get("connections", {}),
            "strategy": flow_payload.get("strategy", {"type": "DRAFT" if not publish else "DEPLOYED"}),
        }
        response = await self._request("POST", "/api/v1/flows", json_body=create_body)
        result: Dict[str, Any] = {
            "action": "created",
            "status_code": response.status_code,
        }
        if response.status_code in (200, 201):
            try:
                created = response.json()
                result["flow"] = created
                if publish and created.get("id"):
                    await self.enable_flow(created["id"])
            except Exception:
                result["raw"] = response.text
        else:
            result["error"] = response.text
        return result

    async def _update_flow(self, flow_id: str, flow_payload: Dict[str, Any], *, publish: bool) -> Dict[str, Any]:
        update_body = {
            "displayName": flow_payload.get("name", "Customer Service Flow"),
            "trigger": flow_payload.get("trigger", {}),
            "steps": flow_payload.get("steps", []),
            "connections": flow_payload.get("connections", {}),
            "strategy": flow_payload.get("strategy", {"type": "DRAFT" if not publish else "DEPLOYED"}),
        }
        response = await self._request("PUT", f"/api/v1/flows/{flow_id}", json_body=update_body)
        result: Dict[str, Any] = {
            "action": "updated",
            "flow_id": flow_id,
            "status_code": response.status_code,
        }
        if response.status_code in (200, 202):
            try:
                result["flow"] = response.json()
            except Exception:
                result["raw"] = response.text
            if publish:
                await self.enable_flow(flow_id)
        else:
            result["error"] = response.text
        return result

    async def _find_flow_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        if not name:
            return None
        flows = await self.list_flows()
        for flow in flows:
            if flow.get("displayName") == name or flow.get("name") == name:
                return flow
        return None

    async def enable_flow(self, flow_id: str) -> Dict[str, Any]:
        response = await self._request("POST", f"/api/v1/flows/{flow_id}/enable")
        return {
            "action": "enable",
            "flow_id": flow_id,
            "status_code": response.status_code,
            "ok": response.status_code < 400,
        }

    async def disable_flow(self, flow_id: str) -> Dict[str, Any]:
        response = await self._request("POST", f"/api/v1/flows/{flow_id}/disable")
        return {
            "action": "disable",
            "flow_id": flow_id,
            "status_code": response.status_code,
            "ok": response.status_code < 400,
        }

    async def delete_flow(self, flow_id: str) -> Dict[str, Any]:
        response = await self._request("DELETE", f"/api/v1/flows/{flow_id}")
        return {
            "action": "delete",
            "flow_id": flow_id,
            "status_code": response.status_code,
            "ok": response.status_code < 400,
        }

    # ------------------------------------------------------------------
    # 3. Connections (credentials)
    # ------------------------------------------------------------------
    async def list_connections(self) -> List[Dict[str, Any]]:
        try:
            response = await self._request("GET", "/api/v1/connections")
            if response.status_code == 200:
                data = response.json()
                return data if isinstance(data, list) else data.get("data", [])
            return []
        except Exception as exc:
            print(f"[ActivepiecesConnector] list_connections error: {exc}")
            return []

    async def upsert_telegram_connection(
        self,
        bot_token: str,
        *,
        name: str = "telegram_bot",
    ) -> Dict[str, Any]:
        """
        Create or update a Telegram bot connection in Activepieces so the
        telegram-bot piece can authenticate outbound replies.
        """
        existing = await self._find_connection_by_name(name)
        body = {
            "name": name,
            "pieceName": "telegram-bot",
            "authType": "CUSTOM_AUTH",
            "auth": {"type": "CUSTOM_AUTH", "value": {"token": bot_token}},
        }
        if existing and existing.get("id"):
            response = await self._request("PUT", f"/api/v1/connections/{existing['id']}", json_body=body)
            action = "updated"
        else:
            response = await self._request("POST", "/api/v1/connections", json_body=body)
            action = "created"
        result: Dict[str, Any] = {
            "action": action,
            "name": name,
            "status_code": response.status_code,
        }
        if response.status_code in (200, 201):
            try:
                result["connection"] = response.json()
            except Exception:
                result["raw"] = response.text
        else:
            result["error"] = response.text
        return result

    async def _find_connection_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        if not name:
            return None
        connections = await self.list_connections()
        for conn in connections:
            if conn.get("name") == name:
                return conn
        return None

    # ------------------------------------------------------------------
    # 4. Flow definition loader
    # ------------------------------------------------------------------
    def _load_flow_definition(self) -> Dict[str, Any]:
        path = Path(self.flow_definition_path)
        if not path.exists():
            raise FileNotFoundError(f"Activepieces flow definition not found: {path}")
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def get_flow_definition(self) -> Dict[str, Any]:
        """Public accessor for the flow definition JSON."""
        return self._load_flow_definition()


# Module-level singleton for convenience
_connector: Optional[ActivepiecesConnector] = None


def get_connector() -> ActivepiecesConnector:
    global _connector
    if _connector is None:
        _connector = ActivepiecesConnector()
    return _connector