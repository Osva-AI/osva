# Changelog

All notable OSVA changes are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.0] - TBD

Stable Community Edition release prepared in repository (**not published** until maintainer tag and registry publish). Builds on registry-verified **`1.1.0-rc.4`** plus M15 production-adoption closeout (source-only; no new SQL migrations).

### Added (since stable 1.0.0 — cumulative 1.1.x line)

- **Durable runtime and recovery:** Execution leases, heartbeats, fencing, worker recovery ticker, BullMQ enqueue outcomes (`JobQueue.enqueue` result type).
- **Knowledge and retrieval:** Knowledge indexes, ingestion worker, embeddings gateway, runtime `context.knowledge.search`.
- **MCP integrations:** Streamable HTTP MCP server, connector SDK, ToolGateway-mediated MCP client, Host header validation on `/mcp`.
- **Human identity and workspaces (M11):** Better Auth password sessions, fixed workspace roles, Console login and membership administration (migrations **`0024`–`0026`**).
- **Model and tool management (M12–M13):** Model provider connections, declarative agents, playground memory restrictions, evaluation quality gates (migrations **`0027`–`0029`**).
- **Console studios:** Agents, workflows, runs, artifacts, Evaluation Studio browser acceptance (M13.7.5), operator diagnostics and recovery guidance (M15.3).
- **Evaluation and quality gates:** Batch evaluation coordinator, quality gate persistence and Console surfacing.
- **Security hardening (M14):** ToolGateway/MCP authorization, capability tokens, adversarial acceptance fixtures, operation-bound workflow approvals (migration **`0030`**), audit durability, human-session abuse controls.
- **Operational diagnostics (M15):** Unified `pnpm acceptance:m15` replay, upgrade runbook through **`0030`**, RC.4 registry-only consumer acceptance harness (`pnpm acceptance:r11-registry`).
- **Community adoption tooling:** `@osva-ai/cli` M10.2 agent workflow (`init`, `validate`, `deploy`, `run`, `status`, `doctor`), canonical dependency-adoption example.

### Security

- **Zod ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)):** Workspace dependency **Zod 4.6.7** with bounded collection validation (shipped on RC.4 line).
- Dependency vulnerability remediation on RC.4 baseline (PR **#58**).

### Upgrade

- From **`v1.0.0`:** migrations through **`0030`** required. See [`docs/operations/UPGRADE.md`](docs/operations/UPGRADE.md).
- From **`1.1.0-rc.4`:** intended aligned version bump only (npm `@rc` → stable **`1.1.0`**, PyPI, GHCR); schema unchanged at **`0030`**.

### Known limitations

- Registry-only journey **5c** (agent + authorized MCP tool invoke) remains **NOT RUN** in harness; discover/import covered.
- OIDC/SAML/SCIM enterprise identity deferred.
- S3-compatible artifact independent restore not acceptance-tested (same as 1.0.0 note).
- Stable **`1.1.0`** registry acceptance blocked until publication (`OSVA_REGISTRY_ACCEPTANCE_TARGET=stable`).

## [1.1.0-rc.4] - 2026-10-26

Security-focused release candidate. Aligns all public `@osva-ai/*` npm packages to the same version. **Published** to npm **`@rc`**, PyPI **`1.1.0rc4`**, and GHCR **`:1.1.0-rc.4`** (see [`docs/release/R1_1_DISTRIBUTION_CLOSEOUT.md`](docs/release/R1_1_DISTRIBUTION_CLOSEOUT.md)).

### Security

- **Zod ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)):** Workspace dependency upgraded to **Zod 4.6.7**. Collection validation in `@osva-ai/contracts` uses bounded array/object/set/map sizes to mitigate denial-of-service via oversized inputs.
- **Runtime Protocol V1:** Capability response schemas enforce collection size bounds on inbound capability payloads.

### Fixed

- **Console verification:** Vitest worker concurrency and build-order reliability for Console tests (no product behavior change).

### Compatibility

- **osva-adapters / external consumers:** Pin all `@osva-ai/*` packages to **`1.1.0-rc.4`** together. Includes M12.4.3 artifact blob storage root exports from RC.3 plus this security remediation.
- **Upgrade from RC.3:** Drop-in npm version bump when all aligned packages move together; no HTTP `/v1` break.

### Known limitations (historical prep note; superseded by R1.1 publication)

- At RC.4 prep time, multi-channel publication was pending; **R1.1** later verified npm, PyPI, and GHCR for **`1.1.0-rc.4`**.

## [1.1.0-rc.3] - 2026-10-24

Release candidate prepared for npm publication (A1.3.2). Aligns all public `@osva-ai/*` npm packages to the same version. **Not published** until maintainer tag and registry publish.

### Fixed

- **`@osva-ai/contracts`:** Published **`1.1.0-rc.2`** npm tarball omitted M12.4.3 artifact blob storage exports (`ArtifactBlobStore`, `RegisteredArtifactBlobStoreModule`, `ARTIFACT_STORAGE_DRIVER_REGISTERED`, and related config types) that exist in repository source. RC.3 restores these symbols on the public root entry in the packed artifact.

### Added

- Release regression: packed `@osva-ai/contracts` root export check for artifact blob storage (`scripts/release/contracts-pack-artifact-exports.mjs`).

## [1.1.0-rc.2] - 2026-10-17

Corrected release candidate published to npm, PyPI, GHCR, and GitHub Releases (tag **`v1.1.0-rc.2`**; registry acceptance in [`docs/release/M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](docs/release/M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md)). Supersedes incomplete **`1.1.0-rc.1`** npm CLI packaging for the M10.2 agent developer workflow.

### Fixed

- **`@osva-ai/cli`:** npm pack now includes agent scaffold **templates**, **`ajv`**, and M10.2 commands (`init`, `validate`, `deploy`, `run`, `status`, `doctor`). Published **`@osva-ai/cli@1.1.0-rc.1`** on npm remains the pre-M10.2 SDK wrapper only.
- **Documentation:** Community quickstart uses GHCR image coordinates, omits `--build` for pre-built images, and documents PyPI install as **`osva-sdk==1.1.0rc2`**.

## [1.1.0-rc.1] - 2026-10-14

Release candidate for Community Edition self-hosting. **Not a general availability (GA) announcement.** Registry artifacts and git tags remain unpublished until RC.3 verification and maintainer approval.

### Community scope and boundaries

- Self-hosted Compose and Helm on operator-managed PostgreSQL, Valkey, and artifact storage (filesystem or S3-compatible configuration).
- Product Console is loopback-bound by default; not included in default Compose/Helm charts. Not a public internet admin UI without reverse-proxy hardening.
- API-key RBAC only; no managed Team/Enterprise SSO, SCIM, or billing identity.
- PostgreSQL is lifecycle authority; Valkey/BullMQ is transport. No general high-availability or zero-downtime guarantee.
- Tool and workflow external side effects are not exactly-once. Idempotency keys identify logical effects per contracts.
- Cross-store backup atomicity is not guaranteed. M9.7 validated filesystem independent restore; **S3-compatible independent restore is NOT acceptance-tested.**
- Release-readiness **kind** job scope is narrower than full M9.7 B.4 (see [`docs/operations/M9_7_ACCEPTANCE_SUMMARY.md`](docs/operations/M9_7_ACCEPTANCE_SUMMARY.md)).
- OpenTelemetry export is opt-in; collector outage does not stop execution (export may drop).

### Product functionality

- **M7:** Canonical dependency-adoption example (`examples/canonical-dependency-adoption`) and root `canonical:*` operator commands.
- **M8:** Community Product Console — agents, onboarding, visual Workflow Definition V3 editor, publish review, workflow runs, run detail, artifact experience.
- TypeScript SDK: `auth`, `runObservability`, `workflowEvents` resources; HTTP `requestId` on errors via `OsvaApiError.requestId`.

### Reliability

- Execution leases, heartbeats, and fencing on RunAttempt (`0023_execution_lease_slice`).
- Expired lease fails the **same** attempt with `EXECUTION_INTERRUPTED`; abandoned `RUNNING` attempts are never automatically re-executed.
- Worker-hosted recovery ticker; transport repair for lost BullMQ deliveries reusing RunAttempt ID.
- BullMQ enqueue-claim hardening and `JobQueue.enqueue` outcome reporting (`enqueued` vs `already_present`).

### Security

- Community API-key RBAC enforcement and workspace-scoped `/v1` stability pass extensions.
- Abuse rate limiting (`429 RATE_LIMITED` with `Retry-After`); **503 SERVICE_UNAVAILABLE** when the rate-limit Valkey store is unavailable (fail-closed).
- Console trust-boundary hardening; deprecated `OSVA_CONSOLE_ALLOW_PUBLIC_BIND` does not enable public bind or authentication.

### Operations

- OpenTelemetry tracing and metrics across control plane and workers; optional Compose observability overlay and Helm `telemetry` values.
- Example Prometheus alert rules and Grafana dashboard provisioning (query Prometheus export names, not raw OTEL dotted names).
- Process `/health` and `/ready` probes for worker, scheduler, workflow-orchestrator, and knowledge-worker.
- M9.7 production acceptance harness (`pnpm acceptance:m9-7b`) and sanitized evidence summary.

### Deployment

- Helm: omit Postgres/Valkey URLs from ConfigMaps when `existingSecret` is set; optional `secretEnv` Secret.
- Optional authenticated Valkey in production Compose templates.

### Upgrade compatibility (from published `v1.0.0`)

- **Database:** Git tag **`v1.0.0`** ends at migration **`0022_api_security_slice`**. This release requires **`0023_execution_lease_slice`**. See [`docs/operations/UPGRADE.md`](docs/operations/UPGRADE.md).
- **Runtime:** Legacy unleased `RUNNING` rows require operator review after upgrade. See [`docs/operations/EXECUTION_RECOVERY.md`](docs/operations/EXECUTION_RECOVERY.md).
- **HTTP `/v1`:** Additive `429`/`503` error codes; optional `execution` diagnostics on RunAttempt resources.
- **`@osva-ai/contracts`:** `JobQueue.enqueue` now returns `Promise<JobEnqueueResult>` instead of `Promise<void>`. Callers that ignore the result remain valid; **custom `JobQueue` implementers must update** (see [`docs/release/COMPATIBILITY.md`](docs/release/COMPATIBILITY.md)).

## [1.0.0] - 2026-09-22

OSS 1.0 Community Edition baseline. Release implementation and release acceptance verified in-repository (including Linux kind CI).

> **Migration note (2026-10):** The published git tag **`v1.0.0`** includes SQL through **`0022_api_security_slice`**. Migration **`0023_execution_lease_slice`** shipped in the **1.1.x** line. An earlier draft of this section incorrectly listed 0023 under 1.0.0.

### Workflow / runtime

- Durable workflow semantics and PostgreSQL-backed orchestration (waits, events, approvals).
- Workflow Definition v1/v2 (sequential, branch, parallel, join, approval).
- Runtime Protocol V1 and Remote HTTP runtime adapter.
- Trusted TypeScript runtime and optional Docker Engine `CONTAINER` runtime (disabled by default in deployment templates).

### Agents / execution

- Agent registry with immutable AgentVersions and frozen effective bindings on Runs.
- Run / RunAttempt lifecycle with BullMQ transport on Valkey.
- ExecutionWorker composition root with ModelGateway, ToolGateway, MemoryGateway, and knowledge bindings.

### Scheduling

- Cron schedules with PostgreSQL authority and scheduler process (`COALESCE_ONE` misfire policy).

### Artifacts

- Filesystem and S3-compatible artifact storage drivers with shared contract surface.

### Knowledge / retrieval

- Knowledge indexes, ingestion worker, embeddings gateway, and runtime `context.knowledge.search`.

### MCP / connectors

- MCP client in ToolGateway, streamable HTTP MCP server process, Host header validation, connector SDK (`@osva-ai/connector-sdk`).

### API / security

- Authenticated `/v1` API with API keys, bootstrap flow, and stability pass on public routes.

### SDKs / CLI

- Public npm packages: `@osva-ai/contracts`, `@osva-ai/runtime-protocol`, `@osva-ai/sdk`, `@osva-ai/cli`, `@osva-ai/connector-sdk` at **1.0.0**.
- Python `osva-sdk` **1.0.0** with `OSVAClient`.

### Deployment

- Single OCI image (`OSVA_PROCESS` entrypoint) for six application processes plus migrate/bootstrap.
- Self-hosted Docker Compose distribution with bundled Postgres/Valkey for convenience.
- Helm chart for Kubernetes with external Postgres, Valkey, and recommended S3 artifact storage.
- Release-readiness CI: image smoke, Compose acceptance, Helm validation, kind smoke, package pack/install verification.

### Observability

- Optional OpenTelemetry integration per telemetry contract.

### Migrations / compatibility

- Append-only SQL migrations through **`0022_api_security_slice`** at tag **`v1.0.0`** (no downgrade tooling).
- `/v1` API compatibility expectations documented for OSS 1.0.
