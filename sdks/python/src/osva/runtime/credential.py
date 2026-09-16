from __future__ import annotations


class CapabilityCredential:
    def __init__(self, endpoint: str, token: str) -> None:
        self.endpoint = endpoint.rstrip("/")
        self._token = token

    def authorization_header(self) -> str:
        return f"Bearer {self._token}"

    def __repr__(self) -> str:
        return f"CapabilityCredential({self.endpoint!r})"

    def to_json(self) -> dict[str, str]:
        return {"endpoint": self.endpoint, "token": "[REDACTED]"}
