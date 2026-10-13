# Changelog

All notable OSVA changes are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Observability

- Control-plane HTTP request spans, counters, duration histograms, and structured completion logs with bounded route families.
- BullMQ queue process spans, time-to-start, job-count gauges, and stall/failure counters.
- Execution recovery counters for CAS-won lease interruptions, transport repairs, and recovery errors.
- Bounded security-event counters, including missing-Bearer authentication events.
- Per-process OpenTelemetry service names (`osva-web`, `osva-worker`, `osva-scheduler`, `osva-workflow-orchestrator`) and optional `OTEL_TRACES_SAMPLER` support.
- `osva.run_attempt.duration_ms` for attempt outcomes; `osva.run.duration_ms` remains a compatibility alias. Runtime duration is `osva.runtime.execute.duration_ms`.
- Schema-integrity diagnostic (`pnpm db:migrations:integrity`) detects journal/schema drift, including missing 0023 lease columns and `run_attempts_expired_lease_idx`, without applying SQL.
- Additive RunAttempt `execution` diagnostics for lease/recovery state. Raw `executionOwner` remains internal.
- Console Run Detail shows execution diagnostics. Console request-guard rejections emit bounded security events.
- `/ready` may name `postgres` and/or `valkey` as the failed dependency without leaking connection details.
- MCP and knowledge-worker initialize the existing OpenTelemetry lifecycle (`osva-mcp`, `osva-knowledge-worker`).
- `JobQueue.enqueue` reports `enqueued` vs `already_present`. `osva.recovery.transport_repaired` increments only for newly accepted deliveries.
- Optional Compose observability overlay (`compose.observability.yml`) starts a pinned OpenTelemetry Collector, example Prometheus, and loopback Grafana. Default Compose stays no-op.
- Helm `telemetry` values inject per-process OTEL settings when enabled. The application chart does not deploy a collector.
- Example Grafana dashboards and Prometheus alerts query Prometheus names (`osva_http_requests_total`), not dotted OTEL instruments.

### Reliability

- Execution leases, heartbeats, and fencing on RunAttempt. Expired ownership fails the same attempt with `EXECUTION_INTERRUPTED`; abandoned `RUNNING` attempts are never automatically re-executed.
- Worker-hosted recovery ticker repairs lost `QUEUED`/`PENDING` BullMQ deliveries using the existing RunAttempt ID.

### Deployment

- Helm omits PostgreSQL/Valkey URLs from ConfigMaps when `existingSecret` is set. `secretEnv` now renders an optional extra Secret.
- Process `/health` and `/ready` probes for worker, scheduler, workflow-orchestrator, and knowledge-worker.
- Optional authenticated Valkey in production Compose; local `docker-compose.yml` remains no-auth.
- Community Console binds loopback only (`127.0.0.0/8`, `::1`, `localhost`). `OSVA_CONSOLE_ALLOW_PUBLIC_BIND` is deprecated and does not enable public or LAN binding, authentication, or access control. Console remains off Compose/Helm.

## [1.0.0] - 2026-09-22

OSS 1.0 Community Edition baseline. Release implementation and release acceptance verified in-repository (including Linux kind CI).

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

- Append-only SQL migrations through `0023_execution_lease_slice` (no downgrade tooling).
- `/v1` API compatibility expectations documented for OSS 1.0.
