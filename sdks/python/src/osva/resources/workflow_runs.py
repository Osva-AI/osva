from __future__ import annotations

from typing import Any

from osva.http_client import HTTPClient


class WorkflowRunsResource:
    def __init__(self, client: HTTPClient, workspace_id: str) -> None:
        self._client = client
        self._workspace_id = workspace_id

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = {"workspaceId": self._workspace_id, **payload}
        return self._client.request("POST", "/v1/workflow-runs", body=body)

    def get(self, workflow_run_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/workflow-runs/{workflow_run_id}")
