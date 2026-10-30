# R1.1.3 — registry-only published-artifact acceptance

Replay of the **M10.4E** pattern: install and operate OSVA using **only** published npm, PyPI, and GHCR artifacts (no `workspace:*`, no local image build).

**Targets** (`OSVA_REGISTRY_ACCEPTANCE_TARGET`, default **`rc4`**):

| Value | Meaning |
|-------|---------|
| `rc4` | RC.4 published line |
| `stable` | Platform **1.1.0** historical target (npm @1.1.0 known defective) |
| `stable-npm-111` | Corrective **npm @1.1.1** on platform **1.1.0** (blocked until publish + `registryArtifactsReady`) |


| Target | Gate env | Status |
|--------|----------|--------|
| **`rc4`** | `OSVA_RC4_REGISTRY_ACCEPTANCE=1` | **Ready** — verified **`1.1.0-rc.4`** artifacts |
| **`stable`** | `OSVA_STABLE_REGISTRY_ACCEPTANCE=1` | **Historical** platform **`1.1.0`** (npm @1.1.0 defective; manifest audit fails if replayed) |
| **`stable-npm-111`** | `OSVA_STABLE_NPM_111_REGISTRY_ACCEPTANCE=1` | **Blocked** until npm **`1.1.1`** published + acceptance recorded |

## Prerequisites

- Docker Compose v2
- Node.js 24+
- Python 3.11+ (`python` or `python3` on PATH)
- Network access to npm, PyPI, and GHCR

## Run

```bash
# RC4 historical replay (default target)
OSVA_RC4_REGISTRY_ACCEPTANCE=1 pnpm acceptance:r11-registry

# Stable 1.1.0 (after publication + target readiness update)
OSVA_REGISTRY_ACCEPTANCE_TARGET=stable OSVA_STABLE_REGISTRY_ACCEPTANCE=1 pnpm acceptance:r11-registry
```

Focused groups (R1.1.3B): `OSVA_R11_GROUPS=workflow,mcp,multipart` or `--group=workflow --group=mcp`. Values: `preflight`, `stack`, `workflow`, `mcp`, `consumers`, `multipart`, `restart`, `full`.

MCP connector discover/import uses the fake HTTP MCP test fixture on the host (`host.docker.internal`) with compose `OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS=true` when the `mcp` group runs.

Windows PowerShell:

```powershell
$env:OSVA_RC4_REGISTRY_ACCEPTANCE = "1"
pnpm acceptance:r11-registry
```

Optional preflight only (registry audit + runtime image verify, no Compose stack):

```bash
OSVA_RC4_REGISTRY_ACCEPTANCE=1 OSVA_R11_SKIP_COMPOSE=1 pnpm acceptance:r11-registry
```

Published image smoke (no local build):

```bash
OSVA_SKIP_IMAGE_BUILD=1 OSVA_IMAGE=ghcr.io/osva-ai/osva:1.1.0-rc.4 node scripts/deployment/docker-image-smoke.mjs
```

Registry Compose acceptance wiring (subset of full R1.1 replay):

```bash
OSVA_RC4_REGISTRY_ACCEPTANCE=1 OSVA_COMPOSE_NO_BUILD=1 OSVA_IMAGE=ghcr.io/osva-ai/osva:1.1.0-rc.4 OSVA_DEPLOY_ACCEPTANCE=true node scripts/deployment/deploy-compose-acceptance.mjs
```

## Isolation

- Compose project: **`osva-r11-registry-rc4`** (stable: **`osva-r11-registry-stable`**; override with `COMPOSE_PROJECT_NAME`)
- Host ports: **18080** (web), **13100** (MCP) by default
- Teardown: `docker compose -p osva-r11-registry down -v` (runner executes on success/failure)

## Evidence

Record results in [`docs/release/M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](../../../docs/release/M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md), machine-readable [`docs/release/R1_1_3B_REGISTRY_EVIDENCE.json`](../../../docs/release/R1_1_3B_REGISTRY_EVIDENCE.json), and reconcile [`docs/release/R1_1_RELEASE_DISTRIBUTION.md`](../../../docs/release/R1_1_RELEASE_DISTRIBUTION.md).
