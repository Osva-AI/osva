from __future__ import annotations

from typing import Any

from osva.http_client import HTTPClient


class SchedulesResource:
    def __init__(self, client: HTTPClient, workspace_id: str) -> None:
        self._client = client
        self._workspace_id = workspace_id

    def list(self, **query: str | None) -> dict[str, Any]:
        return self._client.request(
            "GET",
            "/v1/schedules",
            query={"workspaceId": self._workspace_id, **query},
        )

    def get(self, schedule_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/schedules/{schedule_id}")
