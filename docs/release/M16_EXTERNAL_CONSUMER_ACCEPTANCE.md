# M16 external-consumer acceptance summary

| Layer | Stage A (source / local-pack) | Stage B (published registries) |
|-------|------------------------------|--------------------------------|
| Version matrix | [`M16_5B_RELEASE_VERSION_MATRIX.md`](M16_5B_RELEASE_VERSION_MATRIX.md) | Same coordinates on npm/PyPI/GHCR |
| npm CLI M16 commands | `pnpm release:npm-pack-smoke` + local-pack harness | `pnpm acceptance:m16-registry` with **`OSVA_M16_ARTIFACT_SOURCE=published`** |
| OCI entrypoints | `node scripts/deployment/verify-installation-image.mjs` | GHCR digest audit in target **`m16-111`** |
| Install + onboarding + agent run | `acceptance:m16-registry` local-pack | Registry install group |
| Lifecycle | `acceptance:m16-4-lifecycle` or registry lifecycle group | Registry lifecycle group |
| **1.1.0 → 1.1.1 upgrade** | Registry **`upgrade`** group (local target image override) | Published **`1.1.0`** + **`1.1.1`** GHCR tags |

## Published release identity (Stage B)

| Artifact | Version / ref |
|----------|----------------|
| Platform (GHCR) | **`1.1.1`** — `ghcr.io/osva-ai/osva:1.1.1` |
| npm (`@osva-ai/cli` and workspace packages) | **`1.1.2`** |
| PyPI (`osva-sdk`) | **`1.1.1`** |
| Git tag | **`v1.1.1`** |
| Release commit | **`20dbdb8fd52f13ff0368679ff4d6aa6edb3aa814`** |

Recorded registry digests and PyPI hashes for replay audits live in **`scripts/acceptance/r11-registry-only/lib/targets.mjs`** (`M16_111_TARGET`, `registryArtifactsReady: true`).

## Stage B evidence (published-only)

**Harness:** `pnpm acceptance:m16-registry` with:

```text
OSVA_M16_REGISTRY_ACCEPTANCE=1
OSVA_REGISTRY_ACCEPTANCE_TARGET=m16-111
OSVA_M16_ARTIFACT_SOURCE=published
OSVA_ACCEPTANCE_LIVE=1
OSVA_M16_GROUPS=preflight,install,lifecycle,upgrade
```

**Outcome (2026-03-28):** **38 PASS**, **0 FAIL**, **0 SKIP**, **0 NOT_RUN** — full install, lifecycle, and **1.1.0 → 1.1.1** upgrade journeys against published npm **1.1.2**, GHCR **1.1.1**, and PyPI **1.1.1** coordinates.

Parent journey rows aggregate child checks (`registry_install_journey`, `registry_lifecycle_journey`, `registry_upgrade_journey`); a failed child cannot yield a passing parent.

### Host and runtime scope

| Verified | Not claimed without separate runs |
|----------|-----------------------------------|
| **Windows 10/11** host, **Docker Desktop** with **linux/amd64** images (GHCR platform tags) | Native **Linux** host CLI (without this harness on Linux) |
| Published **npm 1.1.2** CLI driving Compose on the host | Native **macOS** host acceptance |
| Loopback Console, MCP, and API ports on the acceptance host | ARM-only or multi-arch host matrix |

Do not describe Stage B as “Linux/macOS verified” unless the same harness is executed on those hosts with published artifacts.

## Upgrade path notes

Legacy **1.1.0** installs that match **`deploy/compose`** (pre-M16 `osva setup`) are bootstrapped in the **`upgrade`** group before **`osva platform upgrade --to 1.1.1`**. The **1.1.0 → 1.1.1** catalog path has **`migrationRequired: false`**; backup attestation is required only when migrations are required.

**Deterministic execution:** Hello Agent example uses the deterministic trusted runtime fixture (no paid model provider).
