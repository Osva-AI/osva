# Changelog

All notable OSVA changes are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Reliability

- Execution leases, heartbeats, and fencing on RunAttempt. Expired ownership fails the same attempt with `EXECUTION_INTERRUPTED`; abandoned `RUNNING` attempts are never automatically re-executed.
- Worker-hosted recovery ticker repairs lost `QUEUED`/`PENDING` BullMQ deliveries using the existing RunAttempt ID.

### Deployment

- Helm omits PostgreSQL/Valkey URLs from ConfigMaps when `existingSecret` is set. `secretEnv` now renders an optional extra Secret.
- Process `/health` and `/ready` probes for worker, scheduler, workflow-orchestrator, and knowledge-worker.
- Optional authenticated Valkey in production Compose; local `docker-compose.yml` remains no-auth.
- Console rejects public binds unless `OSVA_CONSOLE_ALLOW_PUBLIC_BIND=true`. Console remains off Compose/Helm.

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
