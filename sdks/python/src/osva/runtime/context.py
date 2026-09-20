from __future__ import annotations

from typing import Any

import httpx

from osva.runtime.credential import CapabilityCredential
from osva.runtime.errors import RuntimeCapabilityError

PROTOCOL_VERSION = "1"
GENERATE_TEXT_PATH = "/v1/runtime/capabilities/models/generate-text"
INVOKE_TOOL_PATH = "/v1/runtime/capabilities/tools/invoke"
KNOWLEDGE_SEARCH_PATH = "/v1/runtime/capabilities/knowledge/search"
ARTIFACT_GET_PATH = "/v1/runtime/capabilities/artifacts/get"
ARTIFACT_CREATE_PATH = "/v1/runtime/capabilities/artifacts/create"
ARTIFACT_CONTENT_PATH = "/v1/runtime/capabilities/artifacts/content"


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


class ArtifactsCapability:
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

    async def get(self, *, artifact_id: str) -> dict[str, Any]:
        payload = {
            "protocolVersion": PROTOCOL_VERSION,
            "executionId": self._execution_id,
            "artifactId": artifact_id,
        }
        response = await self._post_json(ARTIFACT_GET_PATH, payload)
        if response.get("outcome") != "SUCCEEDED":
            error = response.get("error", {})
            raise RuntimeCapabilityError(str(error.get("message", "Artifact get failed.")))
        artifact = response.get("artifact")
        if not isinstance(artifact, dict):
            raise RuntimeCapabilityError("Invalid artifact capability response.")
        return artifact

    async def create(
        self,
        *,
        name: str,
        content: bytes,
        media_type: str | None = None,
    ) -> dict[str, Any]:
        files = {"file": (name, content, media_type or "application/octet-stream")}
        data = {
            "executionId": self._execution_id,
            "name": name,
        }
        if media_type is not None:
            data["mediaType"] = media_type
        try:
            response = await self._client.post(
                f"{self._credential.endpoint}{ARTIFACT_CREATE_PATH}",
                data=data,
                files=files,
                headers={
                    "authorization": self._credential.authorization_header(),
                    "accept": "application/json",
                },
            )
        except httpx.HTTPError as error:
            raise RuntimeCapabilityError("Capability transport failed.") from error
        body = response.json()
        if not isinstance(body, dict):
            raise RuntimeCapabilityError("Capability response was not an object.")
        if body.get("outcome") != "SUCCEEDED":
            capability_error = body.get("error", {})
            if not isinstance(capability_error, dict):
                capability_error = {}
            raise RuntimeCapabilityError(
                str(capability_error.get("message", "Artifact create failed."))
            )
        artifact = body.get("artifact")
        if not isinstance(artifact, dict):
            raise RuntimeCapabilityError("Invalid artifact capability response.")
        return artifact

    async def open(self, *, artifact_id: str) -> httpx.Response:
        url = (
            f"{self._credential.endpoint}{ARTIFACT_CONTENT_PATH}"
            f"?executionId={self._execution_id}&artifactId={artifact_id}"
        )
        try:
            return await self._client.get(
                url,
                headers={"authorization": self._credential.authorization_header()},
            )
        except httpx.HTTPError as error:
            raise RuntimeCapabilityError("Capability transport failed.") from error

    async def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
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


class KnowledgeCapability:
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

    async def search(
        self,
        *,
        binding: str,
        query: str,
        top_k: int | None = None,
        filter: dict[str, object] | None = None,
    ) -> list[dict[str, object]]:
        payload: dict[str, Any] = {
            "protocolVersion": PROTOCOL_VERSION,
            "executionId": self._execution_id,
            "bindingName": binding,
            "query": query,
        }
        if top_k is not None:
            payload["topK"] = top_k
        if filter is not None:
            payload["filter"] = filter
        response = await self._post(KNOWLEDGE_SEARCH_PATH, payload)
        if response.get("outcome") != "SUCCEEDED":
            error = response.get("error", {})
            raise RuntimeCapabilityError(
                str(error.get("message", "Knowledge search failed.")),
            )
        hits = response.get("hits")
        if not isinstance(hits, list):
            raise RuntimeCapabilityError("Invalid knowledge capability response.")
        return hits

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
        self.artifacts = ArtifactsCapability(
            execution_id=execution_id,
            credential=credential,
            client=client,
        )
        self.knowledge = KnowledgeCapability(
            execution_id=execution_id,
            credential=credential,
            client=client,
        )
