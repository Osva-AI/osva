from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from osva.runtime.context import RuntimeContext
from osva.runtime.credential import CapabilityCredential
from osva.runtime.errors import RuntimeExecutionError, RuntimeProtocolError

PROTOCOL_VERSION = "1"
MAX_BODY_BYTES = 1_048_576


ExecuteFn = Callable[[Any, RuntimeContext], Awaitable[Any]]


class Runtime:
    def __init__(self) -> None:
        self._execute_fn: ExecuteFn | None = None

    def execute(self, fn: ExecuteFn) -> ExecuteFn:
        self._execute_fn = fn
        return fn

    async def handle_execute_request(self, body: dict[str, Any]) -> dict[str, Any]:
        if body.get("protocolVersion") != PROTOCOL_VERSION:
            raise RuntimeProtocolError(
                f"Unsupported protocol version: {body.get('protocolVersion')!r}."
            )

        required = ("executionId", "input", "capabilities")
        if any(key not in body for key in required):
            raise RuntimeProtocolError("Invalid Runtime Protocol V1 execute request.")

        execution_id = str(body["executionId"])
        capabilities = body["capabilities"]
        if not isinstance(capabilities, dict):
            raise RuntimeProtocolError("Invalid capability credential in execute request.")

        endpoint = capabilities.get("endpoint")
        token = capabilities.get("token")
        if not isinstance(endpoint, str) or not isinstance(token, str):
            raise RuntimeProtocolError("Invalid capability credential in execute request.")

        if self._execute_fn is None:
            raise RuntimeProtocolError("Runtime execute handler is not configured.")

        credential = CapabilityCredential(endpoint, token)
        async with httpx.AsyncClient(timeout=30.0) as client:
            context = RuntimeContext(
                execution_id=execution_id,
                credential=credential,
                client=client,
            )
            try:
                output = await self._execute_fn(body["input"], context)
                return {
                    "protocolVersion": PROTOCOL_VERSION,
                    "executionId": execution_id,
                    "outcome": "SUCCEEDED",
                    "output": output,
                }
            except RuntimeExecutionError as error:
                return {
                    "protocolVersion": PROTOCOL_VERSION,
                    "executionId": execution_id,
                    "outcome": "FAILED",
                    "error": {"code": error.code, "message": str(error)[:500]},
                }
            except Exception as error:  # noqa: BLE001
                return {
                    "protocolVersion": PROTOCOL_VERSION,
                    "executionId": execution_id,
                    "outcome": "FAILED",
                    "error": {
                        "code": "AGENT_EXECUTION_FAILED",
                        "message": str(error)[:500] or "Agent execution failed.",
                    },
                }

    def asgi_app(self, path: str = "/execute") -> Callable[..., Awaitable[None]]:
        async def app(scope: dict[str, Any], receive: Any, send: Any) -> None:
            if scope.get("type") != "http":
                await send({"type": "http.response.start", "status": 400, "headers": []})
                await send({"type": "http.response.body", "body": b""})
                return

            request_path = scope.get("path", "")
            method = scope.get("method", "GET")
            if method != "POST" or request_path != path:
                await _send_json(send, 404, _protocol_failure("Not found."))
                return

            body_bytes = b""
            while True:
                message = await receive()
                if message["type"] != "http.request":
                    continue
                body_bytes += message.get("body", b"")
                if len(body_bytes) > MAX_BODY_BYTES:
                    await _send_json(
                        send, 413, _protocol_failure("Request body exceeds maximum size.")
                    )
                    return
                if not message.get("more_body", False):
                    break

            try:
                parsed = json.loads(body_bytes.decode("utf-8"))
            except json.JSONDecodeError:
                await _send_json(send, 400, _protocol_failure("Request body must be valid JSON."))
                return

            if not isinstance(parsed, dict):
                await _send_json(
                    send, 400, _protocol_failure("Request body must be a JSON object.")
                )
                return

            try:
                result = await self.handle_execute_request(parsed)
            except RuntimeProtocolError as error:
                await _send_json(
                    send,
                    400,
                    {
                        "protocolVersion": PROTOCOL_VERSION,
                        "outcome": "FAILED",
                        "error": {"code": error.code, "message": str(error)},
                    },
                )
                return

            await _send_json(send, 200, result)

        return app


async def _send_json(send: Any, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


def _protocol_failure(message: str) -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "outcome": "FAILED",
        "error": {"code": "RUNTIME_PROTOCOL_FAILURE", "message": message},
    }
