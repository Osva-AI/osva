"""Container Runtime Protocol V1 example for OSVA Stage 3.1."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx

from osva.runtime.context import RuntimeContext
from osva.runtime.runtime import Runtime

runtime = Runtime()


@runtime.execute
async def execute(input: Any, context: RuntimeContext) -> Any:
    if isinstance(input, dict) and input.get("mode") == "echo":
        return input

    if isinstance(input, dict) and input.get("mode") == "sleep":
        await asyncio.sleep(float(input.get("seconds", 60)))
        return {"slept": True}

    if isinstance(input, dict) and input.get("mode") == "tool":
        output = await context.tools.invoke(
            binding=str(input.get("binding", "echo")),
            input=input.get("payload", {}),
        )
        return {"toolOutput": output}

    if isinstance(input, dict) and input.get("mode") == "fail":
        raise RuntimeError(str(input.get("message", "agent failure")))

    if isinstance(input, dict) and input.get("mode") == "bad_stdout":
        sys.stdout.write("log line\n")
        sys.stdout.flush()

    return input


def _bootstrap_request_url(base_url: str, execution_id: str) -> str:
    parsed = urlparse(base_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["executionId"] = execution_id
    return urlunparse(parsed._replace(query=urlencode(query)))


async def _fetch_execute_request() -> dict[str, Any]:
    bootstrap_url = os.environ.get("OSVA_RUNTIME_BOOTSTRAP_URL", "").strip()
    bootstrap_token = os.environ.get("OSVA_RUNTIME_BOOTSTRAP_TOKEN", "").strip()
    execution_id = os.environ.get("OSVA_EXECUTION_ID", "").strip()

    if not bootstrap_url or not bootstrap_token or not execution_id:
        raise RuntimeError(
            "Missing OSVA runtime bootstrap environment (URL, token, or execution id)."
        )

    request_url = _bootstrap_request_url(bootstrap_url, execution_id)

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                request_url,
                headers={
                    "Authorization": f"Bearer {bootstrap_token}",
                    "Accept": "application/json",
                },
                timeout=30.0,
            )
            response.raise_for_status()
            raw = response.text
    except httpx.HTTPError as error:
        raise RuntimeError("Runtime bootstrap request failed.") from error

    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError("RuntimeExecuteRequest must be a JSON object.")

    if parsed.get("executionId") != execution_id:
        raise RuntimeError("RuntimeExecuteRequest execution id mismatch.")

    return parsed


async def _run() -> None:
    request = await _fetch_execute_request()
    response = await runtime.handle_execute_request(request)
    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()


def main() -> None:
    try:
        asyncio.run(_run())
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
