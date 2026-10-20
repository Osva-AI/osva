# M12.4.3 Acceptance Summary — Public Infrastructure Adapter Contracts

**Slice:** Public artifact blob store port + trusted registration + external consumer proof.

**Pre-commit audit (M12.4.3):** See sections below. **READY TO COMMIT** for slice scope; re-run `pnpm verify:ci:clean` optionally before merge (one prior failure classified as flake — see Verification).

## Selected adapter category

**Artifact blob store** (`ArtifactBlobStore`).

**Rationale:** Minimal interface; existing env drivers; clear security boundary (opaque bytes only); `@osva/domain` already isolated metadata; realistic first osva-adapters package.

**Alternatives deferred:** JobQueue (public port but static BullMQ wiring), ModelProviderAdapter (private), vector/embedding (domain ports), OpenTelemetry (no public port).

## Public API contract

| Surface | Location |
| --- | --- |
| `ArtifactBlobStore`, `ArtifactBlobContentStream`, read/write types | `@osva-ai/contracts` → `artifact-blob-store.ts` |
| Storage config + `registered` driver types | `@osva-ai/contracts` → `artifact-storage-config.ts` |
| Domain re-export | `@osva/domain` ports re-export from contracts (in-repo adapters unchanged) |

**Versioning:** Semver on `@osva-ai/contracts`; breaking changes require major bump and contract tests under `packages/contracts/test/`.

## Composition strategy

| Process | Built-in default | External adapter |
| --- | --- | --- |
| **Worker** | `filesystem` / `s3` via `createArtifactBlobStore` | `OSVA_ARTIFACT_STORAGE_DRIVER=registered` + `OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE`, or `WorkerProcessDependencies.artifactBlobStore` |
| **Web** | Same sync factory | Inject `WebProcessDependencies.artifactBlobStore`, or built-in `filesystem` / `s3` only via env |
| **Knowledge worker** | Same sync factory | Inject `KnowledgeWorkerProcessDependencies.artifactBlobStore`, or built-in `filesystem` / `s3` only via env |

Loader: `@osva/adapters-artifact-storage` (`resolveArtifactBlobStoreFromConfig`, `loadRegisteredArtifactBlobStore`).

**Fail-closed:** Unknown drivers, missing register module, invalid module exports, and sync `createArtifactBlobStore` with `registered` driver throw explicit errors. If the same `registered` env is applied to web/knowledge-worker without DI, **process construction fails** (no silent split-brain with built-in drivers).

## Evidence matrix (what is and is not proven)

| Claim | Status | Evidence |
| --- | --- | --- |
| External package typecheck | **PASS** | `node scripts/acceptance/m12-4-3/run.mjs` (packed `@osva-ai/contracts`, fixture outside workspace) |
| Registered loader unit tests | **PASS** | `@osva/adapters-artifact-storage` (7 tests, fixture module write/open/delete) |
| Worker composition hook (`registered` / DI) | **PASS** | Code: `apps/worker/src/process.ts` uses `resolveArtifactBlobStoreFromConfig` in async startup |
| Worker → web cross-process artifact access (`filesystem` / `s3`) | **PASS** (unchanged) | Existing integration tests (shared PostgreSQL + shared storage config); not re-run in this audit |
| Worker → web cross-process with **`registered` driver** | **NOT DONE** | No integration test; web/kw do not resolve `registered` from env; uniform `registered` env fails web/kw at sync factory |
| Worker integration with external npm adapter package | **NOT DONE** | Requires custom deployment image + adapter on `node_modules`; no GHCR E2E in this slice |
| Public npm publication of new contract fields | **NOT DONE** | Follows normal `@osva-ai/contracts` release; local proof uses `pnpm pack` only |
| Custom deployment image with adapter preinstalled | **NOT DONE** | Documented operator requirement; not validated in CI |
| Full `pnpm verify:ci` | **PASS** | Exit 0 (~53 min local), including integration |
| Full `pnpm verify:ci:clean` | **NOT RE-RUN** in audit | One prior run exit 1 (knowledge-worker Vitest teardown — see Verification) |

## Production composition audit (trace)

| Step | Worker | Web | Knowledge worker |
| --- | --- | --- | --- |
| Init | `loadArtifactStorageConfig(env)` → `resolveArtifactBlobStoreFromConfig` (async in `onStart`) or DI | Sync `createArtifactBlobStore` or DI | Sync `createArtifactBlobStore` or DI |
| Write path | `ArtifactApplication` → `ArtifactBlobStore.write` + Postgres metadata | Same pattern for HTTP upload | Ingestion via `createArtifact` / `openArtifactContent` |
| Read/download | Runtime capabilities + same blob store instance | HTTP list/get/content routes | Parser reads artifact stream |
| Shutdown | Worker stop closes DB/queue/telemetry; **no blob store dispose hook** (adapter lifecycle = process lifetime) | Web stop closes queues/server | KW stop closes queue/probes |

**Registered end-to-end conclusion:** A worker on the `registered` driver can persist metadata and bytes **in that process**. The web API can retrieve the same artifact **only if web uses a blob store backed by the same logical storage** (today: shared `filesystem`/`s3` config, or **future** web/kw `resolveArtifactBlobStoreFromConfig` / coordinated DI). **M12.4.3 does not claim registered cross-process E2E**; defer web/kw env-based async resolve to a follow-up slice.

## Registration security audit

| Control | Finding |
| --- | --- |
| Module specifier source | **Operator env only** (`OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE`) via `loadArtifactStorageConfig`; not exposed on REST, workflows, agents, or connectors |
| Specifier validation | **Minimal** (non-empty string); Node `import(specifier)` resolves from deployment `node_modules` / file URLs — no allowlist (trusted operator model) |
| Dynamic import errors | Wrapped in explicit `Error` messages; failed worker startup if `onStart` throws |
| Invalid exports | Fail if `createArtifactBlobStore` missing or return value fails `assertArtifactBlobStore` |
| Factory failures | Propagate to worker startup (no fallback to built-in) |
| Secrets in adapter config | `ArtifactStorageConfigRegistered` carries no secret fields; adapter reads its own env |
| Workspace isolation | Unchanged — `ArtifactApplication` / authorization; adapter sees opaque keys only |
| Untrusted code loading | **Not** selectable from product APIs; no marketplace or discovery |

## External consumer proof

| Layer | Evidence |
| --- | --- |
| Type compilation | `test-fixtures/artifact-blob-store-external-consumer/` (not in pnpm workspace) |
| Package consumption | `node scripts/acceptance/m12-4-3/run.mjs` installs packed `@osva-ai/contracts` tarball via npm |
| Runtime registration | In-repo registered loader tests only (not external npm adapter package) |

## Security boundaries

- Adapters cannot bypass ArtifactApplication metadata, workspace checks, or digest/idempotency rules.
- Registration is operator-controlled (env or trusted DI), not workflow/agent controlled.
- No automatic adapter discovery or remote fetching.
- Registered modules run in-process with worker/web privileges.

## osva-adapters — first package specification

| Field | Recommendation |
| --- | --- |
| **Package name** | `@osva-ai/adapter-artifact-memory` (reference/test double) or `@osva-ai/adapter-artifact-azure` (first production-oriented backend) |
| **Public OSVA deps** | `@osva-ai/contracts` (semver range matching platform release, e.g. `^1.1.0-rc.2` until stable) |
| **Private OSVA deps** | None for implementation |
| **Node** | `>=24` (match contracts engines) |
| **Configuration** | Accept `ArtifactStorageConfigRegistered`; backend-specific env documented in adapter README |
| **Registration** | Export `createArtifactBlobStore` as `RegisteredArtifactBlobStoreModule`; operator sets `OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE` after installing into deployment image |
| **Required tests** | Unit tests for write/open/delete, maxBytes enforcement, digest prefix; cross-process E2E after web/kw resolve follow-up |
| **Compatibility policy** | Declare minimum `@osva-ai/contracts` and OSVA platform release in adapter `COMPATIBILITY.md` |
| **Publication** | Independent semver on npm; test with `pnpm pack` against OSVA acceptance runner pattern |

## Deferred categories

- Model provider public port
- JobQueue external composition without custom distribution
- Vector store / embedding provider ports
- OpenTelemetry exporter port
- Web/knowledge-worker `registered` env resolution (async startup) for multi-process deployments

## Verification

| Step | Command | Exit code |
| --- | --- | --- |
| Prettier (repo) | `pnpm exec prettier --check .` (via `pnpm verify:ci`) | 0 |
| Full CI harness (non-clean) | `pnpm verify:ci` | 0 (~53 min local run) |
| M12.4.3 pack consumer | `node scripts/acceptance/m12-4-3/run.mjs` | 0 |
| Registered loader tests | `@osva/adapters-artifact-storage` (7 tests) | 0 |
| Contracts port tests | `@osva-ai/contracts` `artifact-blob-store.test.ts` | 0 |
| Docs links | `node scripts/release/docs-link-check.mjs` | 0 |
| Whitespace | `git diff --check` | 0 |
| Isolated knowledge-worker unit tests | `pnpm --filter @osva/knowledge-worker test` | 0 (after clean-gate failure) |
| Full clean gate | `pnpm verify:ci:clean` | **1** once — Vitest `EnvironmentTeardownError` in `apps/knowledge-worker/test/process.test.ts` during parallel repo TEST; **not re-run** in pre-commit audit |

### Clean-gate failure classification

**C — Likely environmental / test-harness flake, not fully proven as non-flake.**

- Failure: `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` in knowledge-worker `process.test.ts` (tests themselves passed 3/3).
- Same file passes in isolation; full `pnpm verify:ci` later passed including integration.
- **No M12.4.3 code change** (not an artifact/regression fix; speculative harness changes out of scope).
