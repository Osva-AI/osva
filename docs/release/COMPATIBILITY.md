# OSVA Community compatibility and release policy

**Stable preparation target:** **`1.1.0`** (repository branch `chore/v1-1-stable-readiness`; **not published** until maintainer tag and registry publish).

**Last registry-verified prerelease:** **`1.1.0-rc.4`** (git tag **`v1.1.0-rc.4`** → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`**). Evidence: [`M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md), [`R1_1_DISTRIBUTION_CLOSEOUT.md`](R1_1_DISTRIBUTION_CLOSEOUT.md).

**npm (RC.4 verified):** all five public packages publish **`1.1.0-rc.4`** on dist-tag **`rc`**. **`latest`** remains **`1.0.0`** until stable publication policy executes.

**PyPI and GHCR (RC.4 verified):** **`pip install osva-sdk==1.1.0rc4`**; **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** (OCI index **`sha256:59148d75…`**, **linux/amd64**). Stable **`1.1.0`** coordinates are **declared** in source but **not registry-verified** until publication and [`acceptance:r11-registry`](../../scripts/acceptance/r11-registry-only/README.md) stable target readiness is updated.

Historical OSS **1.0.0** policy remains in git tag **`v1.0.0`** and [`CHANGELOG.md`](../../CHANGELOG.md).

## Supported platforms (validated vs declared)

| Requirement | Validated (in-repo / RC.4 acceptance) | Declared only |
|-------------|--------------------------------------|---------------|
| **Node.js** | **24.x** (release-readiness CI, registry acceptance, M15 harness) | `engines.node >= 24` on public npm packages |
| **Python** | **3.11+** (RC.4 registry Python journey) | `requires-python >= 3.11` in `osva-sdk` |
| **PostgreSQL** | Compose/Helm acceptance templates | Operator-managed; lifecycle authority |
| **Valkey** | Compose/Helm acceptance templates | Required for BullMQ transport and rate limiting |
| **Container arch** | **linux/amd64** GHCR manifest (RC.4) | Other arches not acceptance-tested |
| **Migration head** | **`0030_approval_operation_binding_slice`** | Forward-only; see [`../operations/UPGRADE.md`](../operations/UPGRADE.md) |

## Upgrade paths

| From | To | Notes |
|------|-----|-------|
| **`v1.0.0`** | **`1.1.0`** | Requires migrations through **`0023`** minimum; full Community **`1.1.0`** head is **`0030`**. See UPGRADE runbook. |
| **`1.1.0-rc.4`** (published) | **`1.1.0`** (stable) | **Intended drop-in** for aligned npm/PyPI/GHCR pins when stable artifacts publish; **no new SQL** between RC.4 tag and stable preparation HEAD. Re-run migrate/integrity for operator hygiene; schema unchanged if already at **`0030`**. |
| **`1.1.0-rc.2`** or older RC | **`1.1.0`** | Apply intermediate migrations and align all `@osva-ai/*` packages together. |

RC.4 registry acceptance **does not** prove stable **`1.1.0`** binaries. Stable qualification requires post-publication registry-only replay (`OSVA_REGISTRY_ACCEPTANCE_TARGET=stable`).

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

| Artifact | Package | Repository `VERSION` (stable prep) | Last registry-verified npm | PyPI / notes |
|----------|---------|-----------------------------------|----------------------------|--------------|
| Contracts | `@osva-ai/contracts` | 1.1.0 | 1.1.0-rc.4 (`@rc`) | Zod **4.6.7** in packed runtime deps |
| Runtime protocol | `@osva-ai/runtime-protocol` | 1.1.0 | 1.1.0-rc.4 (`@rc`) | Capability collection bounds (V1) |
| TypeScript SDK | `@osva-ai/sdk` | 1.1.0 | 1.1.0-rc.4 (`@rc`) | — |
| CLI | `@osva-ai/cli` | 1.1.0 | 1.1.0-rc.4 (`@rc`) | M10.2 agent workflow |
| Connector SDK | `@osva-ai/connector-sdk` | 1.1.0 | 1.1.0-rc.4 (`@rc`) | — |
| Python SDK | `osva-sdk` | 1.1.0 | **1.1.0rc4** (PyPI) | Stable **`1.1.0`** not published |

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
- Tag **`v1.0.0`** ends at **`0022_api_security_slice`**. **`1.1.0-rc.2`** requires **`0023_execution_lease_slice`**. Community **`1.1.0`** requires head **`0030_approval_operation_binding_slice`**. See [`../operations/UPGRADE.md`](../operations/UPGRADE.md).
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
