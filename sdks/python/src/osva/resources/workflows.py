from __future__ import annotations

from typing import Any

from osva.http_client import HTTPClient


class WorkflowsResource:
    def __init__(self, client: HTTPClient) -> None:
        self._client = client

    def list(self) -> dict[str, Any]:
        return self._client.request("GET", "/v1/workflows")

    def get(self, workflow_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/workflows/{workflow_id}")

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("POST", "/v1/workflows", body=payload)

    def create_version(self, workflow_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request(
            "POST",
            f"/v1/workflows/{workflow_id}/versions",
            body=payload,
        )
