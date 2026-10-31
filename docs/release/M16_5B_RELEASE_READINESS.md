# M16.5B release readiness (Stage A handoff)

## Version matrix (chosen)

| Surface | Version |
|---------|---------|
| Platform `VERSION` / GHCR / PyPI / Helm | **1.1.1** |
| npm `@osva-ai/*` | **1.1.2** |

Confirmed **not** published on registries at preparation time (`@osva-ai/cli@1.1.2` → 404).

## Stage A completed (source)

- [x] Version alignment (`pnpm release:version:check`)
- [x] CLI bundled compose install templates + distribution + upgrade catalog
- [x] OCI entrypoint verification helper (`verifyInstallationImageEntrypoints`)
- [x] npm pack smoke extended for M16 templates and commands
- [x] Registry acceptance target **`m16-111`** (digests placeholder)
- [x] Unified harness `pnpm acceptance:m16-registry`
- [x] Documentation updates (compatibility, quickstart pointer, release notes)

## Maintainer actions (Stage B — not executed in Stage A)

1. Merge consolidated PR; run **`pnpm verify:ci:clean`** on release commit.
2. Build and push **`ghcr.io/osva-ai/osva:1.1.1`** (linux/amd64).
3. Publish PyPI **`osva-sdk==1.1.1`**.
4. Publish npm **`@osva-ai/*@1.1.2`** from `.release/npm-artifacts/1.1.2/`.
5. Tag **`v1.1.1`** and create GitHub Release with Helm chart assets.
6. Record GHCR/PyPI digests on **`M16_111_TARGET`**; set **`registryArtifactsReady: true`**.
7. Run Stage B registry acceptance (see [`../scripts/acceptance/m16-registry/README.md`](../../scripts/acceptance/m16-registry/README.md)).

## Local-pack smoke (optional before publish)

```powershell
pnpm release:version:check
node scripts/release/npm-pack-smoke.mjs
docker build -t osva/local-m16-registry:dev -f Dockerfile .
$env:OSVA_ACCEPTANCE_LIVE = "1"
$env:OSVA_M16_ARTIFACT_SOURCE = "local-pack"
$env:OSVA_M16_LOCAL_IMAGE = "osva/local-m16-registry:dev"
$env:OSVA_M16_SKIP_IMAGE_BUILD = "1"
pnpm acceptance:m16-registry
```
