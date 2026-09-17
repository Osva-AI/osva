"""Minimal REMOTE_HTTP runtime server for OSVA integration tests."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from osva.runtime.runtime import Runtime

runtime = Runtime()


@runtime.execute
async def execute(input: Any, context: Any) -> Any:
    if isinstance(input, dict) and input.get("mode") == "model":
        result = await context.models.generate_text(
            binding="primary",
            messages=[{"role": "user", "content": "hello from python"}],
        )
        return {"text": result["text"]}
    if isinstance(input, dict):
        return {"echo": input}
    return input


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/execute":
            self.send_response(404)
            self.end_headers()
            return

        raw = self._read_body()
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(
                400,
                {
                    "protocolVersion": "1",
                    "outcome": "FAILED",
                    "error": {
                        "code": "RUNTIME_PROTOCOL_FAILURE",
                        "message": "Request body must be valid JSON.",
                    },
                },
            )
            return

        if not isinstance(body, dict):
            self._send_json(
                400,
                {
                    "protocolVersion": "1",
                    "outcome": "FAILED",
                    "error": {
                        "code": "RUNTIME_PROTOCOL_FAILURE",
                        "message": "Request body must be a JSON object.",
                    },
                },
            )
            return

        try:
            result = _run_async(runtime.handle_execute_request(body))
        except Exception as error:  # noqa: BLE001
            self._send_json(
                400,
                {
                    "protocolVersion": "1",
                    "outcome": "FAILED",
                    "error": {
                        "code": "RUNTIME_PROTOCOL_FAILURE",
                        "message": str(error),
                    },
                },
            )
            return

        self._send_json(200, result)

    def _read_body(self) -> bytes:
        length = self.headers.get("content-length")
        if length is None:
            raise ValueError("Content-Length header is required.")
        return self.rfile.read(int(length))

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def _run_async(coro: Any) -> Any:
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    host, port = server.server_address
    print(json.dumps({"host": host, "port": port}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
