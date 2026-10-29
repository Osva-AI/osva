# OSVA Community compatibility and release policy

Target release version: **`1.1.0-rc.4`** (security release candidate; git tag **`v1.1.0-rc.4`** → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`**).

**npm (verified M15.5):** all five public packages publish **`1.1.0-rc.4`** on dist-tag **`rc`**. **`latest`** remains **`1.0.0`**.

**PyPI and GHCR (RC.4 published, R1.1 verified):** **`pip install osva-sdk==1.1.0rc4`**; **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** (OCI index **`sha256:59148d75…`**). Registry-only consumer acceptance: [`M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md) and [`R1_1_DISTRIBUTION_CLOSEOUT.md`](R1_1_DISTRIBUTION_CLOSEOUT.md). npm **`latest`** and GHCR **`:latest`** are **not** moved to RC.4.

Last **full multi-channel** registry-verified RC before RC.4: **`1.1.0-rc.2`** ([`M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md)). External adapter packages should pin **`@osva-ai/contracts@1.1.0-rc.4`** for M12.4.3 artifact blob exports and Zod **4.6.7** / bounded collection validation (PR **#56**), or build from this repository.

Published **`1.1.0-rc.1`** npm/PyPI/GHCR artifacts remain on registries for existing pins. **`@osva-ai/cli@1.1.0-rc.1`** is the pre-M10.2 SDK wrapper only (no `init`, `validate`, `deploy`, `run`, `status`, `doctor`, or bundled templates). Use **`1.1.0-rc.2`** or newer from registries (or build from this repository for unreleased commits) for the agent developer CLI.

Historical OSS **1.0.0** policy and package versions remain documented in git tag **`v1.0.0`** and [`CHANGELOG.md`](../../CHANGELOG.md). npm/PyPI **`latest`** dist-tags remain **`1.0.0`**.

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
| **`1.1.0-rc.4`** (npm **`@rc`**) | **Present** — verified by packed export regression and npm publication |

## Public SDKs and CLI

| Artifact | Package | Repository `VERSION` | Last published npm | PyPI / notes |
|----------|---------|----------------------|--------------------|--------------|
| Contracts | `@osva-ai/contracts` | 1.1.0-rc.4 | 1.1.0-rc.4 (`@rc`) | Zod **4.6.7** in packed runtime deps |
| Runtime protocol | `@osva-ai/runtime-protocol` | 1.1.0-rc.4 | 1.1.0-rc.4 (`@rc`) | Capability collection bounds (V1) |
| TypeScript SDK | `@osva-ai/sdk` | 1.1.0-rc.4 | 1.1.0-rc.4 (`@rc`) | — |
| CLI | `@osva-ai/cli` | 1.1.0-rc.4 | 1.1.0-rc.4 (`@rc`) | Includes M10.2 agent workflow (not in RC1 npm CLI) |
| Connector SDK | `@osva-ai/connector-sdk` | 1.1.0-rc.4 | 1.1.0-rc.4 (`@rc`) | — |
| Python SDK | `osva-sdk` | 1.1.0-rc.4 | **1.1.0rc4** (PyPI) | **`pip install osva-sdk==1.1.0rc4`** |

Semver applies to published packages. **Minor** releases (1.0 → 1.1) may include additive `/v1` behavior, new optional fields, and documented adapter-interface changes below.

Monorepo consumers use `workspace:*` for `@osva-ai/*` dependencies; published installs must align all `@osva-ai/*` packages to the same release version.

## JobQueue adapter interface (TypeScript)

`JobQueue` is a **published** interface on `@osva-ai/contracts` (see [`docs/contracts/JOB_QUEUE_CONTRACT.md`](../contracts/JOB_QUEUE_CONTRACT.md)). Production OSVA uses `@osva/adapters-bullmq`; `MemoryJobQueue` is the in-process test adapter.

### Change in 1.1.x

| Method | 1.0.0 | 1.1.0-rc.2 |
|--------|-------|------------|
| `enqueue(runAttemptId)` | `Promise<void>` | `Promise<JobEnqueueResult>` with `{ outcome: "enqueued" \| "already_present" }` |

**Callers** that ignore the return value remain valid.

**Custom implementers** (third-party or forked `JobQueue` adapters) must:

1. Return `JobEnqueueResult` distinguishing newly accepted deliveries from idempotent `already_present`.
2. Recompile against `@osva-ai/contracts@1.1.x`.

This is a **TypeScript source-breaking change for implementers**, not an HTTP `/v1` break. It is intentional: transport recovery metrics and repair logic depend on enqueue outcomes. It is classified as a **minor** semver change under OSVA policy (not a 2.0.0 API revision). A **v2.0.0** release is **not** required solely for this contract change.

## Version alignment policy

Root **`VERSION`**, all five public npm packages (`@osva-ai/contracts`, `@osva-ai/runtime-protocol`, `@osva-ai/sdk`, `@osva-ai/cli`, `@osva-ai/connector-sdk`), Python **`osva-sdk`**, and Helm **`Chart.yaml`** `version` / `appVersion` **must match**. `pnpm release:version:check` enforces this. Publishing a contracts-only npm version without bumping the aligned set **fails release readiness** even when platform code is unchanged.

RC.4 is a **security-focused** release (Zod remediation + validation bounds). **npm (`@rc`), PyPI, and GHCR RC.4 artifacts are published**; see [`R1_1_DISTRIBUTION_CLOSEOUT.md`](R1_1_DISTRIBUTION_CLOSEOUT.md) for acceptance scope and limitations.

## Database migrations

- Migrations are forward-only.
- Tag **`v1.0.0`** ends at **`0022_api_security_slice`**. **`1.1.0-rc.2`** requires **`0023_execution_lease_slice`**. Community **`1.1.0-rc.4`** baseline requires head **`0030_approval_operation_binding_slice`**. See [`../operations/UPGRADE.md`](../operations/UPGRADE.md).
- Downgrading application images without a matching schema is unsupported.

## Human identity and authentication (M11)

- **Machine compatibility:** Existing workspace API keys and API-key RBAC semantics are unchanged.
- **Human authentication:** Additive `/v1/auth/*` routes and session cookies; Console default mode does not require `OSVA_CONSOLE_API_KEY`.
- **Identity bootstrap:** Legacy workspaces keep `organization_id = null` until `pnpm identity:bootstrap` (explicit operator step).
- **Deferred:** OIDC is future Community work, not part of M11. SAML/SCIM remain Teams/Enterprise scope.

## Support windows

Community Edition does not promise indefinite security or feature support windows beyond maintainer documentation and [`SECURITY.md`](../../SECURITY.md) reporting expectations.

## Enterprise features

Enterprise-only capabilities (SAML, SCIM, advanced policy, billing, etc.) are **out of scope** for Community Edition. **OIDC** is planned as future Community work and was **not** part of M11.
