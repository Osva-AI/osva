# OSVA Community compatibility and release policy

**Current stable platform line:** **`1.2.0`** — git tag **`v1.2.0`** → **`f1fcb2bae162e63c831eb140ade6d4a74c0fb70f`**. [GitHub Release](https://github.com/Osva-AI/osva/releases/tag/v1.2.0). Migration head **`0045_inference_budget_recovery`**.

**Registry-verified published artifacts (`1.2.0`):** five npm `@osva-ai/*` packages on dist-tag **`latest`**; PyPI **`osva-sdk==1.2.0`**; GHCR **`ghcr.io/osva-ai/osva:1.2.0`** (**linux/amd64**); Helm chart **`osva-1.2.0.tgz`** attached to the GitHub release. Acceptance harness: **`OSVA_REGISTRY_ACCEPTANCE_TARGET=m12-120`** — **45 PASS**, 0 FAIL (consumer path validated on **Windows 10**, Docker Desktop; do not infer ARM, macOS, or native Linux host support from this evidence).

**Historical registry-verified lines (preserved):** platform **`1.1.1`** (M16, target **`m16-111`** / npm **`1.1.2`**); npm **`1.1.4`** on **`latest`** before **`1.2.0`** (M17.9, target **`m17-114`**). Prior M16 matrix: [`M16_5B_RELEASE_VERSION_MATRIX.md`](M16_5B_RELEASE_VERSION_MATRIX.md).

**M19 ecosystem npm (sibling repositories, verified 2026-11-06):** eleven additional public packages — three **osva-adapters** releases (`adapter-artifact-memory` / `adapter-artifact-azure` **0.1.2**, `runtime-cli-sidecar` **0.1.0**) and eight **osva-connectors** releases (Wave 1 + SDK **1.1.4** realignment). Inventory: [`../operations/M19_CLOSEOUT_SUMMARY.md`](../operations/M19_CLOSEOUT_SUMMARY.md) §5 · [osva-connectors M19_PUBLICATION_RECORD](https://github.com/Osva-AI/osva-connectors/blob/main/docs/M19_PUBLICATION_RECORD.md) · [osva-adapters COMPATIBILITY](https://github.com/Osva-AI/osva-adapters/blob/main/COMPATIBILITY.md).

**Last registry-verified prerelease:** **`1.1.0-rc.4`** (git tag **`v1.1.0-rc.4`** → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`**). Evidence: [`M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md), [`R1_1_DISTRIBUTION_CLOSEOUT.md`](R1_1_DISTRIBUTION_CLOSEOUT.md).

**npm (`1.2.0`, registry-verified):** dist-tag **`latest`** → **1.2.0** on all five `@osva-ai/*` packages: `@osva-ai/contracts`, `@osva-ai/runtime-protocol`, `@osva-ai/sdk`, `@osva-ai/cli`, `@osva-ai/connector-sdk`.

**PyPI and GHCR (`1.2.0`, registry-verified):** **`pip install osva-sdk==1.2.0`**; **`ghcr.io/osva-ai/osva:1.2.0`** (**linux/amd64**).

**Helm (`1.2.0`):** **`osva-1.2.0.tgz`** on the **`v1.2.0`** GitHub release (chart `version` / `appVersion` **1.2.0**).

**npm (historical RC.4 verified):** all five public packages publish **`1.1.0-rc.4`** on dist-tag **`rc`**.

**npm (historical pre-1.2.0 stable line, M17.9):** dist-tags **`latest`** / **`stable-candidate`** pointed at **1.1.4** before **`1.2.0`** publication. Intermediate npm **1.1.1** / **1.1.2** / **1.1.3** tarballs remain on the registry. Do not install defective **`@1.1.0`** npm tarballs — see [`NPM_1_1_1_RECOVERY.md`](NPM_1_1_1_RECOVERY.md).

**PyPI and GHCR (historical RC.4 verified):** **`pip install osva-sdk==1.1.0rc4`**; **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** (OCI index **`sha256:59148d75…`**, **linux/amd64**).

Historical OSS **1.0.0** policy remains in git tag **`v1.0.0`** and [`CHANGELOG.md`](../../CHANGELOG.md).

## Supported platforms (validated vs declared)

| Requirement | Validated (in-repo / RC.4 acceptance) | Declared only |
|-------------|--------------------------------------|---------------|
| **Node.js** | **24.x** (release-readiness CI, registry acceptance, M15 harness) | `engines.node >= 24` on public npm packages |
| **Python** | **3.11+** (RC.4 registry Python journey) | `requires-python >= 3.11` in `osva-sdk` |
| **PostgreSQL** | Compose/Helm acceptance templates | Operator-managed; lifecycle authority |
| **Valkey** | Compose/Helm acceptance templates | Required for BullMQ transport and rate limiting |
| **Container arch** | **linux/amd64** GHCR manifest (`1.2.0` / historical RC.4) | Other arches not acceptance-tested |
| **Migration head** | **`0045_inference_budget_recovery`** (published **`1.2.0`**) | Published **`1.1.1`** shipped through **`0030`**; forward-only; see [`../operations/UPGRADE.md`](../operations/UPGRADE.md) |

## Upgrade paths

| From | To | Notes |
|------|-----|-------|
| **`v1.0.0`** | **`1.1.0`** | Requires migrations through **`0023`** minimum; full Community **`1.1.0`** head is **`0030`**. See UPGRADE runbook. |
| **`1.1.0-rc.4`** (published) | **`1.1.0`** (stable) | **Intended drop-in** for aligned npm/PyPI/GHCR pins when stable artifacts publish; **no new SQL** between RC.4 tag and stable preparation HEAD. Re-run migrate/integrity for operator hygiene; schema unchanged if already at **`0030`**. |
| **`1.1.0-rc.2`** or older RC | **`1.1.0`** | Apply intermediate migrations and align all `@osva-ai/*` packages together. |
| **`1.1.0`** (GHCR/PyPI) | **`1.1.1`** (M16) | **No new SQL** (head remains **`0030`**); **`osva platform upgrade --to 1.1.1`** refreshes compose template (Console + installation-status). Legacy **`deploy/compose`** installs are valid sources. |
| **`1.1.1`** (published platform) | **`1.2.0`** (stable) | **SQL required** through **`0045_inference_budget_recovery`** (**`0031`–`0045`**); use **`osva platform upgrade --to 1.2.0`** with **`@osva-ai/cli@1.2.0`** (or newer **`1.2.x`**). Take a PostgreSQL backup; use **`--backup-confirmed`**. Intermediate **`1.1.0` → `1.2.0`** is **not** cataloged — upgrade **`1.1.0` → `1.1.1`** first. See [`../operations/UPGRADE.md`](../operations/UPGRADE.md). |

RC.4 registry acceptance **does not** prove stable **`1.1.0`** binaries (historical note). **`1.2.0`** registry qualification: **`OSVA_REGISTRY_ACCEPTANCE_TARGET=m12-120`** (45 PASS).

M16/M17/M12 external-consumer harness targets (historical and current):

- **Current published line:** **`OSVA_REGISTRY_ACCEPTANCE_TARGET=m12-120`** (platform **1.2.0**, npm/PyPI **1.2.0**).
- **Historical M17 line:** **`m17-114`** (platform **1.1.1**, npm **1.1.4**).
- **Historical M16 replay:** **`m16-111`** (npm **1.1.2**).

See [`M16_EXTERNAL_CONSUMER_ACCEPTANCE.md`](M16_EXTERNAL_CONSUMER_ACCEPTANCE.md).

## HTTP API

- `/v1` is the stable public HTTP surface for Community Edition.
- Breaking HTTP changes require a deliberate API revision (future `/v2` or documented deprecation), not silent behavior changes.
- **1.1.x additive behaviors:** `429 RATE_LIMITED`, `503 SERVICE_UNAVAILABLE` (rate-limit store unavailable), optional `execution` block on RunAttempt resources.

Clients must key on HTTP status and stable `code` values, not message text. Official TypeScript and Python SDKs do not automatically retry `429`.

## Public contracts

Versioned documents under `docs/contracts/` define manifests, runtime protocol messages, and gateway contracts. SDKs and adapters should track these contracts.

### Artifact blob store (M12.4.3)

`@osva-ai/contracts` root entry exports **`ArtifactBlobStore`**, artifact storage configuration types, **`RegisteredArtifactBlobStoreModule`**, and **`ARTIFACT_STORAGE_DRIVER_REGISTERED`**. Independent adapter packages compile against these symbols only (no workspace coupling).

| Registry state | Artifact blob exports in npm tarball |
|----------------|--------------------------------------|
| **`1.1.0-rc.2`** (published) | **Missing** — tarball predates M12.4.3 merge |
| **`1.1.0-rc.4`** / **`1.1.0`** (source-aligned) | **Present** — verified on RC.4 packed export regression |

## Public SDKs and CLI

| Artifact | Package | Repository `VERSION` | Registry-verified (`1.2.0`) | Historical notes |
|----------|---------|----------------------|------------------------------|------------------|
| Contracts | `@osva-ai/contracts` | 1.2.0 | **1.2.0** (`@latest`) | RC.4 on **`@rc`**: 1.1.0-rc.4 |
| Runtime protocol | `@osva-ai/runtime-protocol` | 1.2.0 | **1.2.0** (`@latest`) | — |
| TypeScript SDK | `@osva-ai/sdk` | 1.2.0 | **1.2.0** (`@latest`) | — |
| CLI | `@osva-ai/cli` | 1.2.0 | **1.2.0** (`@latest`) | M10.2 agent workflow |
| Connector SDK | `@osva-ai/connector-sdk` | 1.2.0 | **1.2.0** (`@latest`) | — |
| Python SDK | `osva-sdk` | 1.2.0 | **1.2.0** (PyPI) | Historical: **1.1.0rc4** on **`@rc`** line |

Semver applies to published packages. **Minor** releases (1.0 → 1.1) may include additive `/v1` behavior, new optional fields, and documented adapter-interface changes below.

Monorepo consumers use `workspace:*` for `@osva-ai/*` dependencies; published installs must align all `@osva-ai/*` packages to the same release version.

## JobQueue adapter interface (TypeScript)

`JobQueue` is a **published** interface on `@osva-ai/contracts` (see [`docs/contracts/JOB_QUEUE_CONTRACT.md`](../contracts/JOB_QUEUE_CONTRACT.md)). Production OSVA uses `@osva/adapters-bullmq`; `MemoryJobQueue` is the in-process test adapter.

### Change in 1.1.x

| Method | 1.0.0 | 1.1.0-rc.2+ |
|--------|-------|-------------|
| `enqueue(runAttemptId)` | `Promise<void>` | `Promise<JobEnqueueResult>` with `{ outcome: "enqueued" \| "already_present" }` |

**Callers** that ignore the return value remain valid.

**Custom implementers** must return `JobEnqueueResult` and recompile against `@osva-ai/contracts@1.1.x`.

## Version alignment policy

Root **`VERSION`**, all five public npm packages, Python **`osva-sdk`**, and Helm **`Chart.yaml`** `version` / `appVersion` **must match**. `pnpm release:version:check` enforces this.

## Database migrations

- Migrations are forward-only.
- Tag **`v1.0.0`** ends at **`0022_api_security_slice`**. **`1.1.0-rc.2`** requires **`0023_execution_lease_slice`**. Community **`1.1.0`** / platform **`1.1.1`** require head **`0030_approval_operation_binding_slice`**. Published **`1.2.0`** requires head **`0045_inference_budget_recovery`**. See [`../operations/UPGRADE.md`](../operations/UPGRADE.md).
- Downgrading application images without a matching schema is unsupported.

## Human identity and authentication (M11)

- **Machine compatibility:** Existing workspace API keys and API-key RBAC semantics are unchanged.
- **Human authentication:** Additive `/v1/auth/*` routes and session cookies; Console default mode does not require `OSVA_CONSOLE_API_KEY`.
- **Identity bootstrap:** Legacy workspaces keep `organization_id = null` until `pnpm identity:bootstrap` (explicit operator step).
- **Deferred:** OIDC is future Community work, not part of M11. SAML/SCIM remain Teams/Enterprise scope.

## Security defaults (M14, preserved in stable prep)

- ToolGateway authorization and MCP beneath ToolGateway (no bypass).
- Workspace isolation on `/v1` resources.
- Human session abuse controls; API key permission enforcement.
- Capability-token restrictions for remote runtimes.
- SSRF / private-network defaults for MCP connectors (**opt-in** `OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS`; **disabled by default**; acceptance-only override in R1.1 MCP journey).
- SecretReference handling (no plaintext secrets in domain records).
- Operation-bound workflow approvals (migration **`0030`**).

## Support windows

Community Edition does not promise indefinite security or feature support windows beyond maintainer documentation and [`SECURITY.md`](../../SECURITY.md) reporting expectations.

## Enterprise features

Enterprise-only capabilities (SAML, SCIM, advanced policy, billing, etc.) are **out of scope** for Community Edition.
