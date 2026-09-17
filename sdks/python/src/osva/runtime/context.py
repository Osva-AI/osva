from __future__ import annotations

from typing import Any

import httpx

from osva.runtime.credential import CapabilityCredential
from osva.runtime.errors import RuntimeCapabilityError

PROTOCOL_VERSION = "1"
GENERATE_TEXT_PATH = "/v1/runtime/capabilities/models/generate-text"
INVOKE_TOOL_PATH = "/v1/runtime/capabilities/tools/invoke"


class ModelsCapability:
    def __init__(
        self,
        *,
        execution_id: str,
        credential: CapabilityCredential,
        client: httpx.AsyncClient,
    ) -> None:
        self._execution_id = execution_id
        self._credential = credential
        self._client = client

    async def generate_text(
        self,
        *,
        binding: str,
        messages: list[dict[str, str]],
        max_output_tokens: int | None = None,
    ) -> dict[str, str]:
        payload: dict[str, Any] = {
            "protocolVersion": PROTOCOL_VERSION,
            "executionId": self._execution_id,
            "bindingName": binding,
            "input": {"messages": messages},
        }
        if max_output_tokens is not None:
            payload["input"]["maxOutputTokens"] = max_output_tokens
        response = await self._post(GENERATE_TEXT_PATH, payload)
        if response.get("outcome") != "SUCCEEDED":
            error = response.get("error", {})
            raise RuntimeCapabilityError(str(error.get("message", "Model capability failed.")))
        result = response.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("text"), str):
            raise RuntimeCapabilityError("Invalid model capability response.")
        return {"text": result["text"]}

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._client.post(
                f"{self._credential.endpoint}{path}",
                json=payload,
                headers={
                    "authorization": self._credential.authorization_header(),
                    "content-type": "application/json",
                    "accept": "application/json",
                },
            )
        except httpx.HTTPError as error:
            raise RuntimeCapabilityError("Capability transport failed.") from error
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeCapabilityError("Capability response was not an object.")
        if data.get("executionId") != self._execution_id:
            raise RuntimeCapabilityError("Capability response executionId mismatch.")
        return data


class ToolsCapability:
    def __init__(
        self,
        *,
        execution_id: str,
        credential: CapabilityCredential,
        client: httpx.AsyncClient,
    ) -> None:
        self._execution_id = execution_id
        self._credential = credential
        self._client = client

    async def invoke(
        self,
        *,
        binding: str,
        input: Any,
        idempotency_key: str | None = None,
    ) -> Any:
        payload: dict[str, Any] = {
            "protocolVersion": PROTOCOL_VERSION,
            "executionId": self._execution_id,
            "bindingName": binding,
            "input": input,
        }
        if idempotency_key is not None:
            payload["idempotencyKey"] = idempotency_key
        response = await self._post(INVOKE_TOOL_PATH, payload)
        if response.get("outcome") != "SUCCEEDED":
            error = response.get("error", {})
            raise RuntimeCapabilityError(str(error.get("message", "Tool capability failed.")))
        return response.get("output")

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._client.post(
                f"{self._credential.endpoint}{path}",
                json=payload,
                headers={
                    "authorization": self._credential.authorization_header(),
                    "content-type": "application/json",
                    "accept": "application/json",
                },
            )
        except httpx.HTTPError as error:
            raise RuntimeCapabilityError("Capability transport failed.") from error
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeCapabilityError("Capability response was not an object.")
        if data.get("executionId") != self._execution_id:
            raise RuntimeCapabilityError("Capability response executionId mismatch.")
        return data


class RuntimeContext:
    def __init__(
        self,
        *,
        execution_id: str,
        credential: CapabilityCredential,
        client: httpx.AsyncClient,
    ) -> None:
        self.execution_id = execution_id
        self.models = ModelsCapability(
            execution_id=execution_id,
            credential=credential,
            client=client,
        )
        self.tools = ToolsCapability(
            execution_id=execution_id,
            credential=credential,
            client=client,
        )
