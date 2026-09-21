from __future__ import annotations

from typing import Any

from osva.http_client import HTTPClient


class RunsResource:
    def __init__(self, client: HTTPClient) -> None:
        self._client = client

    def list(self, **query: str | None) -> dict[str, Any]:
        return self._client.request("GET", "/v1/runs", query=query)

    def get(self, run_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"/v1/runs/{run_id}")

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._client.request("POST", "/v1/runs", body=payload)
