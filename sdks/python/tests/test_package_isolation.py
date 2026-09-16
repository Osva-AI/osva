from __future__ import annotations

from importlib.metadata import PackageNotFoundError, metadata


def test_package_has_no_internal_monorepo_dependencies() -> None:
    try:
        requires = metadata("osva-sdk").get_all("Requires-Dist") or []
    except PackageNotFoundError:
        requires = []
    forbidden = ("osva-db", "bullmq", "osva-domain")
    for requirement in requires:
        name = requirement.split(";")[0].strip().lower()
        for blocked in forbidden:
            assert blocked not in name
