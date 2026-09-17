from __future__ import annotations

import json
from typing import Any

import httpx

from osva.errors import OSVAAPIError, OSVATransportError


class HTTPClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float = 30.0,
        client: httpx.Client | None = None,
    ) -> None:
        normalized = base_url.strip().rstrip("/")
        if not normalized:
            raise ValueError("base_url must not be empty.")
        self._base_url = normalized
        self._timeout = timeout_seconds
        self._client = client or httpx.Client(timeout=timeout_seconds)

    def request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, str | None] | None = None,
        body: Any | None = None,
    ) -> dict[str, Any]:
        params = {key: value for key, value in (query or {}).items() if value is not None}
        url = f"{self._base_url}{path if path.startswith('/') else f'/{path}'}"
        try:
            response = self._client.request(
                method,
                url,
                params=params,
                json=body,
                headers={"content-type": "application/json"} if body is not None else None,
            )
        except httpx.HTTPError as error:
            raise OSVATransportError("OSVA API transport failed.") from error

        try:
            payload = response.json()
        except json.JSONDecodeError as error:
            raise OSVATransportError("OSVA API returned a non-JSON response.") from error

        if response.status_code >= 400:
            if isinstance(payload, dict) and isinstance(payload.get("status"), str):
                body_dict = payload
            else:
                body_dict = {"status": "error"}
            raise OSVAAPIError(response.status_code, body_dict)

        if not isinstance(payload, dict):
            raise OSVATransportError("OSVA API returned an unexpected response shape.")
        return payload
