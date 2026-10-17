# OSVA Community compatibility and release policy

Target release version: **`1.1.0-rc.2`** (release candidate **prepared in-repo**; **`publicationStatus`: unpublished** until maintainer tag/registry publish completes).

Published **`1.1.0-rc.1`** npm/PyPI/GHCR artifacts remain on registries for existing pins. **`@osva-ai/cli@1.1.0-rc.1`** is the pre-M10.2 SDK wrapper only (no `init`, `validate`, `deploy`, `run`, `status`, `doctor`, or bundled templates). Use **`1.1.0-rc.2`** after publish or build from this repository for the agent developer CLI.

Historical OSS **1.0.0** policy and package versions remain documented in git tag **`v1.0.0`** and [`CHANGELOG.md`](../../CHANGELOG.md). npm/PyPI **`latest`** dist-tags remain **`1.0.0`**.

## HTTP API

- `/v1` is the stable public HTTP surface for Community Edition.
- Breaking HTTP changes require a deliberate API revision (future `/v2` or documented deprecation), not silent behavior changes.
- **1.1.x additive behaviors:** `429 RATE_LIMITED`, `503 SERVICE_UNAVAILABLE` (rate-limit store unavailable), optional `execution` block on RunAttempt resources.

Clients must key on HTTP status and stable `code` values, not message text. Official TypeScript and Python SDKs do not automatically retry `429`.

## Public contracts

Versioned documents under `docs/contracts/` define manifests, runtime protocol messages, and gateway contracts. SDKs and adapters should track these contracts.

## Public SDKs and CLI

| Artifact | Package | Prepared RC2 version | PyPI / notes |
|----------|---------|----------------------|--------------|
| Contracts | `@osva-ai/contracts` | 1.1.0-rc.2 | — |
| Runtime protocol | `@osva-ai/runtime-protocol` | 1.1.0-rc.2 | — |
| TypeScript SDK | `@osva-ai/sdk` | 1.1.0-rc.2 | — |
| CLI | `@osva-ai/cli` | 1.1.0-rc.2 | Includes M10.2 agent workflow (not in RC1 npm CLI) |
| Connector SDK | `@osva-ai/connector-sdk` | 1.1.0-rc.2 | — |
| Python SDK | `osva-sdk` | 1.1.0-rc.2 | **`pip install osva-sdk==1.1.0rc2`** (PEP 440) |

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

## Database migrations

- Migrations are forward-only.
- Tag **`v1.0.0`** ends at **`0022_api_security_slice`**. **`1.1.0-rc.2`** requires **`0023_execution_lease_slice`**. See [`../operations/UPGRADE.md`](../operations/UPGRADE.md).
- Downgrading application images without a matching schema is unsupported.

## Support windows

Community Edition does not promise indefinite security or feature support windows beyond maintainer documentation and [`SECURITY.md`](../../SECURITY.md) reporting expectations.

## Enterprise features

Enterprise-only capabilities listed in the roadmap (OIDC, advanced policy, billing, etc.) are **out of scope** for Community Edition.
