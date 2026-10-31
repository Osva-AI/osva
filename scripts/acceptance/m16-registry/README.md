# M16 registry-only external-consumer acceptance

Proves the full M16 journey using **published** npm and GHCR artifacts (Stage B). Stage A uses **`OSVA_M16_ARTIFACT_SOURCE=local-pack`** for release preparation only — results are **not** registry-verified.

## Stage B (published artifacts)

Prerequisites: maintainer publication of platform **1.1.1** and npm **`@osva-ai/*@1.1.2`**, digests recorded on target **`m16-111`**.

```powershell
$env:OSVA_M16_REGISTRY_ACCEPTANCE = "1"
$env:OSVA_REGISTRY_ACCEPTANCE_TARGET = "m16-111"
$env:OSVA_M16_ARTIFACT_SOURCE = "published"
$env:OSVA_ACCEPTANCE_LIVE = "1"
pnpm acceptance:m16-registry
```

Groups: `OSVA_M16_GROUPS=preflight,install,lifecycle,upgrade` (default).

## Stage A (local-pack, pre-release)

```powershell
$env:OSVA_ACCEPTANCE_LIVE = "1"
$env:OSVA_M16_ARTIFACT_SOURCE = "local-pack"
docker build -t osva/local-m16-registry:dev -f Dockerfile .
$env:OSVA_M16_LOCAL_IMAGE = "osva/local-m16-registry:dev"
$env:OSVA_M16_SKIP_IMAGE_BUILD = "1"
pnpm acceptance:m16-registry
```

## Isolation

- Default Compose project prefix: **`osva-m16-registry-111`** (install) and per-run upgrade dirs.
- Loopback ports allocated dynamically (see `m16-2d/lib/ports.mjs`).
- Teardown: `docker compose down` + remove install dir unless `OSVA_M16_SKIP_TEARDOWN=1`.

## Upgrade path

Cross-version acceptance bootstraps a **legacy 1.1.0** layout (`fixtures/compose-platform-1.1.0.yml`) with **`ghcr.io/osva-ai/osva:1.1.0`**, then runs **`osva platform upgrade --to 1.1.1`**. This is the supported adoption path for operators who deployed **`deploy/compose`** before M16 `osva setup`.
