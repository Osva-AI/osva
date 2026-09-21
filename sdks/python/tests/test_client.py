from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from osva.client import OSVAClient
from osva.errors import OSVAAPIError, OSVATransportError
from osva.http_client import HTTPClient

API_KEY = "osva_ak_test_key"


def test_client_sends_bearer_api_key() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, json={"runs": []})

    transport = httpx.MockTransport(handler)
    http = HTTPClient(
        "http://127.0.0.1:9",
        api_key=API_KEY,
        client=httpx.Client(transport=transport),
    )
    client = OSVAClient(base_url="http://127.0.0.1:9", api_key=API_KEY, client=http)
    client.runs.list()
    assert captured["authorization"] == f"Bearer {API_KEY}"


def test_runs_create_does_not_inject_workspace_id() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            201,
            json={"run": {"id": "run-1"}, "runAttempt": {"id": "attempt-1"}},
        )

    transport = httpx.MockTransport(handler)
    http = HTTPClient(
        "http://127.0.0.1:9",
        api_key=API_KEY,
        client=httpx.Client(transport=transport),
    )
    client = OSVAClient(base_url="http://127.0.0.1:9", api_key=API_KEY, client=http)
    client.runs.create(
        {
            "agentId": "agent-1",
            "agentVersionId": "av-1",
            "input": {"hello": True},
        }
    )
    assert "workspaceId" not in captured["body"]


def test_api_error_mapping() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(404, json={"status": "not_found"})
    )
    http = HTTPClient(
        "http://127.0.0.1:9",
        api_key=API_KEY,
        client=httpx.Client(transport=transport),
    )
    client = OSVAClient(base_url="http://127.0.0.1:9", api_key=API_KEY, client=http)
    with pytest.raises(OSVAAPIError) as error:
        client.agents.get("missing")
    assert error.value.status == 404


def test_transport_error_mapping() -> None:
    def boom(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    transport = httpx.MockTransport(boom)
    http = HTTPClient(
        "http://127.0.0.1:9",
        api_key=API_KEY,
        client=httpx.Client(transport=transport),
    )
    client = OSVAClient(base_url="http://127.0.0.1:9", api_key=API_KEY, client=http)
    with pytest.raises(OSVATransportError):
        client.agents.list()


def test_mutation_requests_are_not_retried() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(500, json={"status": "internal_error"})

    transport = httpx.MockTransport(handler)
    http = HTTPClient(
        "http://127.0.0.1:9",
        api_key=API_KEY,
        client=httpx.Client(transport=transport),
    )
    client = OSVAClient(base_url="http://127.0.0.1:9", api_key=API_KEY, client=http)
    with pytest.raises(OSVAAPIError):
        client.runs.create(
            {
                "agentId": "agent-1",
                "agentVersionId": "av-1",
                "input": {},
            }
        )
    assert calls["count"] == 1


def test_client_has_no_workspace_id_constructor_field() -> None:
    annotations = OSVAClient.__init__.__annotations__
    assert "workspace_id" not in annotations


def test_representative_resource_clients_use_api_key_only() -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(200, json={"workflows": [], "runs": []})

    transport = httpx.MockTransport(handler)
    http = HTTPClient(
        "http://127.0.0.1:9",
        api_key=API_KEY,
        client=httpx.Client(transport=transport),
    )
    client = OSVAClient(base_url="http://127.0.0.1:9", api_key=API_KEY, client=http)
    client.workflows.list()
    client.runs.list()
    assert paths == ["/v1/workflows", "/v1/runs"]
