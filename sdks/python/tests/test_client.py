from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from osva.client import OSVAClient
from osva.errors import OSVAAPIError, OSVATransportError
from osva.http_client import HTTPClient


def test_client_injects_workspace_id_for_runs_create() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            201,
            json={"run": {"id": "run-1"}, "runAttempt": {"id": "attempt-1"}},
        )

    transport = httpx.MockTransport(handler)
    http = HTTPClient("http://127.0.0.1:9", client=httpx.Client(transport=transport))
    client = OSVAClient(base_url="http://127.0.0.1:9", workspace_id="ws-1", client=http)
    client.runs.create(
        {
            "agentId": "agent-1",
            "agentVersionId": "av-1",
            "input": {"hello": True},
        }
    )
    assert captured["body"]["workspaceId"] == "ws-1"


def test_api_error_mapping() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(404, json={"status": "not_found"})
    )
    http = HTTPClient("http://127.0.0.1:9", client=httpx.Client(transport=transport))
    client = OSVAClient(base_url="http://127.0.0.1:9", workspace_id="ws-1", client=http)
    with pytest.raises(OSVAAPIError) as error:
        client.agents.get("missing")
    assert error.value.status == 404


def test_transport_error_mapping() -> None:
    def boom(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    transport = httpx.MockTransport(boom)
    http = HTTPClient("http://127.0.0.1:9", client=httpx.Client(transport=transport))
    client = OSVAClient(base_url="http://127.0.0.1:9", workspace_id="ws-1", client=http)
    with pytest.raises(OSVATransportError):
        client.agents.list()


def test_mutation_requests_are_not_retried() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(500, json={"status": "internal_error"})

    transport = httpx.MockTransport(handler)
    http = HTTPClient("http://127.0.0.1:9", client=httpx.Client(transport=transport))
    client = OSVAClient(base_url="http://127.0.0.1:9", workspace_id="ws-1", client=http)
    with pytest.raises(OSVAAPIError):
        client.runs.create(
            {
                "agentId": "agent-1",
                "agentVersionId": "av-1",
                "input": {},
            }
        )
    assert calls["count"] == 1
