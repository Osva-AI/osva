"""Small Python REMOTE_HTTP runtime example."""

from __future__ import annotations

import asyncio
from typing import Any

from osva.runtime.runtime import Runtime

runtime = Runtime()


@runtime.execute
async def execute(input: Any, context: Any) -> Any:
    if isinstance(input, dict) and isinstance(input.get("prompt"), str):
        result = await context.models.generate_text(
            binding="primary",
            messages=[{"role": "user", "content": input["prompt"]}],
        )
        return {"text": result["text"]}
    return input


async def main() -> None:
    try:
        from uvicorn import Config, Server
    except ImportError as error:
        raise SystemExit("Install uvicorn to run this example.") from error

    port = int(__import__("os").environ.get("PORT", "8080"))
    config = Config(runtime.asgi_app(), host="127.0.0.1", port=port, log_level="info")
    server = Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
