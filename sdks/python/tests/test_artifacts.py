from __future__ import annotations

from typing import Any

import httpx
import pytest

from osva.client import OSVAClient
from osva.errors import OSVAAPIError
from osva.http_client import HTTPClient


def test_artifacts_create_uses_multipart_and_workspace() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["content_type"] = request.headers.get("content-type", "")
        return httpx.Response(
            201,
            json={
                "id": "art-1",
                "workspaceId": "ws-1",
                "name": "data.bin",
                "mediaType": "application/octet-stream",
                "sizeBytes": 3,
                "digest": "sha256:" + "a" * 64,
                "metadata": {},
                "createdAt": "2026-01-01T00:00:00.000Z",
            },
        )

    transport = httpx.MockTransport(handler)
    http = HTTPClient("http://127.0.0.1:9", client=httpx.Client(transport=transport))
    client = OSVAClient(base_url="http://127.0.0.1:9", workspace_id="ws-1", client=http)
    result = client.artifacts.create(name="data.bin", content=b"\x01\x02\x03")
    assert result["id"] == "art-1"
    assert captured["method"] == "POST"
    assert captured["path"] == "/v1/artifacts"
    assert "multipart/form-data" in captured["content_type"]


def test_artifacts_download_returns_streaming_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/artifacts/art-1/content"
        return httpx.Response(
            200,
            content=b"payload",
            headers={
                "content-type": "application/octet-stream",
                "content-disposition": 'attachment; filename="x.bin"',
            },
        )

    transport = httpx.MockTransport(handler)
    http = HTTPClient("http://127.0.0.1:9", client=httpx.Client(transport=transport))
    client = OSVAClient(base_url="http://127.0.0.1:9", workspace_id="ws-1", client=http)
    response = client.artifacts.download("art-1")
    assert response.content == b"payload"


def test_artifacts_download_maps_api_errors() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(404, json={"status": "not_found"})
    )
    http = HTTPClient("http://127.0.0.1:9", client=httpx.Client(transport=transport))
    client = OSVAClient(base_url="http://127.0.0.1:9", workspace_id="ws-1", client=http)
    with pytest.raises(OSVAAPIError) as error:
        client.artifacts.download("missing")
    assert error.value.status == 404
