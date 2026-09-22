# Changelog

All notable OSVA changes are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - Unreleased

OSS 1.0 Community Edition baseline. Release candidate implementation and release acceptance verified in-repository (including Linux kind CI). Public tag and registry publication remain pending maintainer approval.

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

- MCP client in ToolGateway, streamable HTTP MCP server process, Host header validation, connector SDK (`@osva/connector-sdk`).

### API / security

- Authenticated `/v1` API with API keys, bootstrap flow, and stability pass on public routes.

### SDKs / CLI

- Public npm packages: `@osva/contracts`, `@osva/runtime-protocol`, `@osva/sdk`, `@osva/cli`, `@osva/connector-sdk` at **1.0.0**.
- Python `osva-sdk` **1.0.0** with `OSVAClient`.

### Deployment

- Single OCI image (`OSVA_PROCESS` entrypoint) for six application processes plus migrate/bootstrap.
- Self-hosted Docker Compose distribution with bundled Postgres/Valkey for convenience.
- Helm chart for Kubernetes with external Postgres, Valkey, and recommended S3 artifact storage.
- Release-readiness CI: image smoke, Compose acceptance, Helm validation, kind smoke, package pack/install verification.

### Observability

- Optional OpenTelemetry integration per telemetry contract.

### Migrations / compatibility

- Append-only SQL migrations through `0022_api_security_slice` (no downgrade tooling).
- `/v1` API compatibility expectations documented for OSS 1.0.
