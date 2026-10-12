from __future__ import annotations

from typing import Any


class OSVAAPIError(Exception):
    """Control-plane `/v1` error. HTTP 429 RATE_LIMITED is not retried by this SDK."""

    def __init__(self, status: int, body: dict[str, Any]) -> None:
        domain = body.get("status", "error")
        super().__init__(f"OSVA API request failed with HTTP {status} ({domain}).")
        self.status = status
        self.body = body


class OSVATransportError(Exception):
    pass
