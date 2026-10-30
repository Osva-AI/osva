# npm 1.1.1 corrective distribution (platform 1.1.0 unchanged)

**Status:** preparation only — **not published**, **not registry-accepted**, **not GA closeout**.

## Problem

npm **`@osva-ai/*@1.1.0`** packages on the public registry ship **unresolved** `catalog:` and `workspace:*` dependency specs. Consumers cannot install the CLI/SDK from npm alone.

Python **`osva-sdk==1.1.0`**, GHCR **`ghcr.io/osva-ai/osva:1.1.0`**, Helm **1.1.0**, and git tag **`v1.1.0`** remain **verified** platform artifacts. This workstream does **not** supersede them.

## Version model

| Surface | Version | Authority |
|---------|---------|-----------|
| Platform / runtime | **1.1.0** | Root `VERSION` |
| Public npm `@osva-ai/*` | **1.1.1** | `NPM_DISTRIBUTION_VERSION` |
| Python SDK | **1.1.0** | `sdks/python/pyproject.toml` |
| Helm chart / appVersion | **1.1.0** | `deploy/helm/osva/Chart.yaml` |
| GHCR image tag | **1.1.0** | Published OCI (unchanged) |

`pnpm release:version:check` enforces: platform surfaces match `VERSION`; npm packages match `NPM_DISTRIBUTION_VERSION`; npm and platform share **major.minor** (1.1.x).

## Maintainer pipeline (local)

```bash
pnpm release:version:check
node scripts/release/npm-pack-artifacts.mjs    # -> .release/npm-artifacts/1.1.1/
node scripts/release/npm-pack-smoke.mjs
node scripts/release/npm-publish-plan.mjs --tag stable-candidate
```

Publish **only** the fingerprinted `.tgz` files when approved. Do **not** promote npm **`latest`** without explicit policy.

## Registry acceptance

| Target | Purpose |
|--------|---------|
| `OSVA_REGISTRY_ACCEPTANCE_TARGET=stable` | Historical **platform 1.1.0** evidence (npm @1.1.0 defective; manifest audit fails by design if replayed) |
| `OSVA_REGISTRY_ACCEPTANCE_TARGET=stable-npm-111` | Post-publish replay for **npm @1.1.1** with Python/GHCR **1.1.0** |

Corrective target gate: `OSVA_STABLE_NPM_111_REGISTRY_ACCEPTANCE=1`. **`registryArtifactsReady` is false** until npm @1.1.1 is published and acceptance completes — do not claim closeout before that run.

## Consumer guidance (draft)

- **npm:** install `@osva-ai/cli@1.1.1` and `@osva-ai/sdk@1.1.1` (exact), not `@1.1.0`.
- **Python / containers:** continue **1.1.0** pins documented in [`UPGRADE.md`](../operations/UPGRADE.md).
- **npm `latest`:** not yet promoted to 1.1.1 in this preparation phase.

## Historical evidence

Defective npm 1.1.0 registry metadata is preserved in fixtures (`scripts/release/test/fixtures/defective-v1-1-0-npm-manifests.json`) and prior acceptance records. Do not rewrite **`v1.1.0`** tag or PyPI/GHCR digests.

See also [`NPM_PUBLICATION.md`](NPM_PUBLICATION.md).
