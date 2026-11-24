# M16 registry-only external-consumer acceptance

Proves the full M16 journey using **published** npm and GHCR artifacts (Stage B). Stage A uses **`OSVA_M16_ARTIFACT_SOURCE=local-pack`** for release preparation only — results are **not** registry-verified.

## Stage B (published artifacts)

Prerequisites:

| Target | Line |
|--------|------|
| **`m12-120`** (current) | Platform **1.2.0**, npm/PyPI **`1.2.0`**, migration head **`0045_inference_budget_recovery`** |
| **`m17-114`** | Platform **1.1.1**, npm **`1.1.4`** |
| **`m16-111`** (historical) | M16 npm **1.1.2** replay |

```powershell
$env:OSVA_M16_REGISTRY_ACCEPTANCE = "1"
$env:OSVA_REGISTRY_ACCEPTANCE_TARGET = "m12-120"
$env:OSVA_M16_ARTIFACT_SOURCE = "published"
$env:OSVA_ACCEPTANCE_LIVE = "1"
pnpm acceptance:m16-registry
```

Prior-line replay (`m17-114` / `m16-111`):

```powershell
$env:OSVA_REGISTRY_ACCEPTANCE_TARGET = "m17-114"
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

| Target | Upgrade path |
|--------|----------------|
| **`m12-120`** | Bootstrap **`1.1.1`** (`fixtures/compose-platform-1.1.1.yml`) → **`osva platform upgrade --to 1.2.0`** (SQL through **`0045_inference_budget_recovery`**) |
| **`m16-111`** / **`m17-114`** | Bootstrap **legacy 1.1.0** → **`osva platform upgrade --to 1.1.1`** |
