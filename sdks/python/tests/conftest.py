from __future__ import annotations

from pathlib import Path

import pytest

FIXTURES_DIR = (
    Path(__file__).resolve().parents[3] / "packages" / "runtime-protocol" / "fixtures" / "v1"
)


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR
