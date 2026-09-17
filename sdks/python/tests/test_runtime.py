from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from osva.runtime.credential import CapabilityCredential
from osva.runtime.errors import RuntimeExecutionError, RuntimeProtocolError
from osva.runtime.runtime import Runtime


@pytest.mark.asyncio
async def test_valid_execute_success(fixtures_dir: Path) -> None:
    fixture = json.loads((fixtures_dir / "execute-request.valid.json").read_text())
    runtime = Runtime()

    @runtime.execute
    async def execute(input: Any, _context: Any) -> Any:
        return input

    response = await runtime.handle_execute_request(fixture)
    assert response["outcome"] == "SUCCEEDED"
    assert response["executionId"] == fixture["executionId"]


@pytest.mark.asyncio
async def test_execute_failure_response(fixtures_dir: Path) -> None:
    fixture = json.loads((fixtures_dir / "execute-request.valid.json").read_text())
    runtime = Runtime()

    @runtime.execute
    async def execute(_input: Any, _context: Any) -> Any:
        raise RuntimeExecutionError("boom")

    response = await runtime.handle_execute_request(fixture)
    assert response["outcome"] == "FAILED"
    assert response["error"]["message"] == "boom"


@pytest.mark.asyncio
async def test_unsupported_protocol_version(fixtures_dir: Path) -> None:
    fixture = json.loads(
        (fixtures_dir / "execute-request.invalid-protocol-version.json").read_text()
    )
    runtime = Runtime()

    @runtime.execute
    async def execute(input: Any, _context: Any) -> Any:
        return input

    with pytest.raises(RuntimeProtocolError):
        await runtime.handle_execute_request(fixture)


@pytest.mark.asyncio
async def test_capability_token_is_redacted() -> None:
    credential = CapabilityCredential("http://127.0.0.1:3000", "super-secret")
    assert "super-secret" not in repr(credential)
    assert credential.to_json()["token"] == "[REDACTED]"


@pytest.mark.asyncio
async def test_execution_id_exposed_on_context(fixtures_dir: Path) -> None:
    fixture = json.loads((fixtures_dir / "execute-request.valid.json").read_text())
    runtime = Runtime()
    seen: dict[str, str] = {}

    @runtime.execute
    async def execute(_input: Any, context: Any) -> Any:
        seen["executionId"] = context.execution_id
        return {"ok": True}

    await runtime.handle_execute_request(fixture)
    assert seen["executionId"] == fixture["executionId"]
