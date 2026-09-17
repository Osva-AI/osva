from __future__ import annotations

import json
from pathlib import Path


def _load(fixtures_dir: Path, name: str) -> dict[str, object]:
    return json.loads((fixtures_dir / name).read_text())


def test_valid_fixtures_have_required_fields(fixtures_dir: Path) -> None:
    execute_request = _load(fixtures_dir, "execute-request.valid.json")
    assert execute_request["protocolVersion"] == "1"
    assert "executionId" in execute_request
    assert "capabilities" in execute_request

    success = _load(fixtures_dir, "execute-response.success.json")
    assert success["outcome"] == "SUCCEEDED"

    failure = _load(fixtures_dir, "execute-response.failure.json")
    assert failure["outcome"] == "FAILED"


def test_invalid_fixtures_are_detectable(fixtures_dir: Path) -> None:
    missing = _load(fixtures_dir, "execute-request.invalid-missing-protocol.json")
    assert "protocolVersion" not in missing

    invalid_version = _load(fixtures_dir, "execute-request.invalid-protocol-version.json")
    assert invalid_version["protocolVersion"] != "1"
