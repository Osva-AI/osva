from __future__ import annotations

from typing import Any

from osva.http_client import HTTPClient


class ApprovalsResource:
    def __init__(self, client: HTTPClient, workspace_id: str) -> None:
        self._client = client
        self._workspace_id = workspace_id

    def get(self, approval_request_id: str) -> dict[str, Any]:
        return self._client.request(
            "GET",
            f"/v1/approval-requests/{approval_request_id}",
            query={"workspaceId": self._workspace_id},
        )

    def decide(self, approval_request_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = {"workspaceId": self._workspace_id, **payload}
        return self._client.request(
            "POST",
            f"/v1/approval-requests/{approval_request_id}/decision",
            body=body,
        )
