from __future__ import annotations

from typing import Any

import httpx

from osva.http_client import HTTPClient


class ArtifactsResource:
    def __init__(self, http: HTTPClient) -> None:
        self._http = http

    def list(self, **query: str | None) -> dict[str, Any]:
        return self._http.request("GET", "/v1/artifacts", query=query)

    def get(self, artifact_id: str) -> dict[str, Any]:
        return self._http.request("GET", f"/v1/artifacts/{artifact_id}")

    def create(
        self,
        *,
        name: str,
        content: bytes,
        media_type: str | None = None,
        metadata: dict[str, Any] | None = None,
        expected_digest: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        data: dict[str, str] = {"name": name}
        if media_type is not None:
            data["mediaType"] = media_type
        if metadata is not None:
            data["metadata"] = __import__("json").dumps(metadata)
        if expected_digest is not None:
            data["expectedDigest"] = expected_digest
        if idempotency_key is not None:
            data["idempotencyKey"] = idempotency_key

        files: dict[str, tuple[str, bytes, str | None]] = {
            "file": (
                name,
                content,
                media_type or "application/octet-stream",
            )
        }
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key is not None else None
        return self._http.upload_multipart(
            "/v1/artifacts",
            data=data,
            files=files,
            headers=headers,
        )

    def download(self, artifact_id: str) -> httpx.Response:
        return self._http.download(f"/v1/artifacts/{artifact_id}/content")
