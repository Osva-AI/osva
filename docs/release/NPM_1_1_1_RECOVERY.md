# npm 1.1.1 corrective distribution (platform 1.1.0 unchanged)

**Status:** corrective npm closeout recorded — **registry acceptance PASS** for target `stable-npm-111`; **npm `latest` not promoted**.

## Problem

npm **`@osva-ai/*@1.1.0`** on the public registry ship **unresolved** `catalog:` and `workspace:*` dependency specs in published tarball manifests. Consumers cannot install the CLI or SDK from npm alone. Those **`1.1.0`** npm versions are **immutable**; they were **not** repaired or overwritten.

Python **`osva-sdk==1.1.0`**, GHCR **`ghcr.io/osva-ai/osva:1.1.0`**, Helm **1.1.0**, and git tag **`v1.1.0`** (`5fa4af2cdad2c5436dfbf7e4ebfb0435da782f3b`) remain the **platform** release line and stay verified.

## Why npm 1.1.1 without a platform bump

| Surface | Version | Rationale |
|---------|---------|-----------|
| Platform / git tag | **1.1.0** | No product or runtime change; same frozen release commit |
| npm `@osva-ai/*` | **1.1.1** | New distribution version with **resolved** packed manifests only |
| Python / GHCR / Helm | **1.1.0** | Already correct; no republication required for recovery |

Implementation merged in PR **#66** (`8b9ce2a04fb29c23e3508b22d268562fd4c06f82`): pack-from-`.tgz` pipeline, manifest audit, and corrective `NPM_DISTRIBUTION_VERSION`.

## Version model

| Surface | Version | Authority |
|---------|---------|-----------|
| Platform / runtime | **1.1.0** | Root `VERSION`, tag **`v1.1.0`** |
| Public npm `@osva-ai/*` | **1.1.1** | `NPM_DISTRIBUTION_VERSION` |
| Python SDK | **1.1.0** | `sdks/python/pyproject.toml` |
| Helm chart / appVersion | **1.1.0** | `deploy/helm/osva/Chart.yaml` |
| GHCR image tag | **1.1.0** | Published OCI (unchanged) |

`pnpm release:version:check` enforces: platform surfaces match `VERSION`; npm packages match `NPM_DISTRIBUTION_VERSION`; npm and platform share **major.minor** (1.1.x).

## Publication (completed)

Five **`@osva-ai/*@1.1.1`** packages published from fingerprinted `.release/npm-artifacts/1.1.1/` tarballs (dependency order: contracts → runtime-protocol → sdk → connector-sdk → cli). Dist-tag **`stable-candidate`** points at **1.1.1**. Dist-tag **`latest`** remains **1.0.0** (no promotion in this closeout).

Published registry consumer smoke: **PASS** (`node scripts/release/npm-registry-consumer-smoke.mjs`).

## Registry acceptance

| Target | Purpose |
|--------|---------|
| `OSVA_REGISTRY_ACCEPTANCE_TARGET=stable` | Historical **platform 1.1.0** target; npm @1.1.0 defective by design if manifest audit replayed |
| `OSVA_REGISTRY_ACCEPTANCE_TARGET=stable-npm-111` | Full replay using **npm @1.1.1** with Python/GHCR **1.1.0** |

Gate: `OSVA_STABLE_NPM_111_REGISTRY_ACCEPTANCE=1`. Target **`stable-npm-111`**: `registryArtifactsReady: true`, `releaseCommit` **`5fa4af2cdad2c5436dfbf7e4ebfb0435da782f3b`**.

**Full R11 registry-only acceptance (2026-10-30):** **19 PASS**, **0 FAIL**, **1 NOT_RUN** (Docker cleanup **PASS**).

Machine-readable evidence: [`V1_1_0_NPM_1_1_1_REGISTRY_EVIDENCE.json`](V1_1_0_NPM_1_1_1_REGISTRY_EVIDENCE.json) (`release`: **`1.1.0-npm-1.1.1`**).

### Remaining coverage gap (unchanged)

| Journey | Status | Reason |
|---------|--------|--------|
| **`journey-05c-mcp-tool-invoke`** | **NOT_RUN** | Harness validates MCP connector registration, discovery, and tool import; it does **not** yet exercise authorized MCP tool invocation through an agent execution |

Do not claim full MCP execution coverage until Journey **5c** is implemented and replayed.

## Consumer guidance

- **npm:** install **`@osva-ai/cli@1.1.1`** and **`@osva-ai/sdk@1.1.1`** (exact). Do **not** use **`@1.1.0`** for npm installs.
- **Python / containers:** continue **1.1.0** pins in [`UPGRADE.md`](../operations/UPGRADE.md).
- **npm `latest`:** still **1.0.0** until an explicit promotion policy is approved and executed.

## Historical evidence

Defective npm 1.1.0 registry metadata is preserved in fixtures (`scripts/release/test/fixtures/defective-v1-1-0-npm-manifests.json`) and prior acceptance records. Do not rewrite **`v1.1.0`** tag or PyPI/GHCR digests.

See also [`NPM_PUBLICATION.md`](NPM_PUBLICATION.md).
