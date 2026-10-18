# OSVA deployment configuration

OSVA processes are configured exclusively through environment variables (or Kubernetes Secrets / Compose `.env` that inject env). There is no secondary configuration framework.

Sensitive values must be supplied by the operator. Examples below use placeholders only.

## Core connectivity

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_DATABASE_URL` | web, worker, scheduler, workflow-orchestrator, knowledge-worker, migrate, bootstrap | yes | — | yes | PostgreSQL connection string (pgvector). With Helm `existingSecret`, supply this in the Secret — it is omitted from the ConfigMap. |
| `OSVA_VALKEY_URL` | web, worker, scheduler, workflow-orchestrator, knowledge-worker | yes | — | yes | Redis-compatible URL for BullMQ transport. Same Secret rule as `OSVA_DATABASE_URL`. Optional Compose `VALKEY_PASSWORD` requires a matching URL (`redis://:password@valkey:6379`). Do not log this value. |
| `OSVA_HEALTH_HOST` | worker, scheduler, workflow-orchestrator, knowledge-worker | no | `127.0.0.1` | no | Process probe bind host. Containers/Helm set `0.0.0.0`. |
| `OSVA_HEALTH_PORT` | worker, scheduler, workflow-orchestrator, knowledge-worker | no | `0` (disabled) | no | `8081` in Compose/Helm. `/health` is liveness; `/ready` re-checks PostgreSQL and Valkey. |

## Web / REST API

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_WEB_HOST` | web | no | `127.0.0.1` | no | Bind address; use `0.0.0.0` in containers. |
| `OSVA_WEB_PORT` | web | no | `3000` | no | HTTP port (TLS terminates at ingress/proxy). |
| `OSVA_RATE_LIMIT_UNAUTH_PER_MINUTE` | web | no | `60` | no | Unauthenticated `/v1` requests per source IP per minute. Abuse protection, not billing. |
| `OSVA_RATE_LIMIT_AUTH_PER_MINUTE` | web | no | `600` | no | Authenticated `/v1` requests per API key per minute. |
| `OSVA_TRUSTED_PROXIES` | web | no | (none) | no | Comma-separated proxy IPs/CIDRs allowed to supply `X-Forwarded-For` / `Forwarded`. Default uses the peer socket address. |

Public routes: `/health`, `/ready` (not rate-limited as API traffic). All `/v1/*` require API key authentication and share the Valkey rate-limit store. Store outage fails closed with `503 SERVICE_UNAVAILABLE`.

## Console (local operator UI)

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_CONSOLE_API_KEY` | console | no* | — | legacy only | *Required only when `OSVA_CONSOLE_LEGACY_API_KEY_MODE=true`. Default Console uses human sessions; never send keys to the browser. |
| `OSVA_CONSOLE_LEGACY_API_KEY_MODE` | console | no | `false` | no | Deprecated opt-in API-key BFF. Requires `OSVA_CONSOLE_API_KEY` when enabled. |
| `OSVA_CONSOLE_HOST` | console | no | `127.0.0.1` | no | Loopback only (`127.0.0.0/8`, `::1`, `localhost`). |
| `OSVA_CONSOLE_PORT` | console | no | `4174` | no | Console HTTP port. |
| `OSVA_CONSOLE_ALLOWED_ORIGINS` | console | no | (none) | no | Explicit browser origins when using an operator proxy. Not CORS or auth. |
| `OSVA_CONSOLE_ALLOW_PUBLIC_BIND` | console | — | — | no | Deprecated. Does not enable public bind or authentication. |

## MCP server

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_MCP_HOST` | mcp-server | no | `127.0.0.1` | no | Bind address. |
| `OSVA_MCP_PORT` | mcp-server | no | `3100` | no | HTTP port. |
| `OSVA_MCP_PATH` | mcp-server | no | `/mcp` | no | Streamable HTTP MCP path. |
| `OSVA_API_BASE_URL` | mcp-server | yes | — | no | OSVA Web base URL for `/v1/auth/context` (e.g. `http://web:3000`). |
| `OSVA_MCP_ALLOWED_HOSTS` | mcp-server | no | (localhost only) | no | Comma-separated allowed `Host` header names for MCP routes. No wildcards. `/health` is not host-filtered (probe-friendly). |
| `OSVA_MCP_STDIO_CONNECTORS_ENABLED` | web, worker, mcp-server | no | `false` | no | STDIO MCP connectors require operator opt-in. |
| `OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS` | web, worker, mcp-server | no | `false` | no | Allows private-network MCP destinations when `true`. |

## Scheduler / workflow orchestrator

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_SCHEDULER_POLL_MS` | scheduler | no | `1000` in-process; Helm `5000` | no | Scheduler tick interval (100–60000). |
| `OSVA_WORKFLOW_ORCHESTRATOR_POLL_MS` | workflow-orchestrator | no | `1000` in-process; Helm `5000` | no | Orchestrator poll interval (100–60000). |

## Artifact storage

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_ARTIFACT_STORAGE_DRIVER` | web, worker, knowledge-worker | no | `filesystem` | no | `filesystem` or `s3`. |
| `OSVA_ARTIFACT_FILESYSTEM_ROOT` | web, worker, knowledge-worker | when filesystem | `.osva/artifacts` | no | Shared volume required for multi-process Compose. |
| `OSVA_ARTIFACT_MAX_BYTES` | web, worker, knowledge-worker | no | `67108864` | no | Max artifact bytes. |
| `OSVA_ARTIFACT_S3_BUCKET` | web, worker, knowledge-worker | when `s3` | — | no | S3-compatible bucket. |
| `OSVA_ARTIFACT_S3_REGION` | web, worker, knowledge-worker | when `s3` | — | no | Region name. |
| `OSVA_ARTIFACT_S3_ENDPOINT` | web, worker, knowledge-worker | no | — | no | Custom endpoint for S3-compatible stores. |
| `OSVA_ARTIFACT_S3_ACCESS_KEY_ID` | web, worker, knowledge-worker | when `s3` | — | yes | Object store access key. |
| `OSVA_ARTIFACT_S3_SECRET_ACCESS_KEY` | web, worker, knowledge-worker | when `s3` | — | yes | Object store secret key. |
| `OSVA_ARTIFACT_S3_FORCE_PATH_STYLE` | web, worker, knowledge-worker | no | `false` | no | Set `true` for many on-prem S3 APIs. |

## Knowledge / embeddings

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_KNOWLEDGE_EMBEDDING_PROVIDER` | web, worker, knowledge-worker | prod: yes | — | no | e.g. `DETERMINISTIC`, `OPENAI_COMPATIBLE`. |
| `OSVA_KNOWLEDGE_EMBEDDING_MODEL` | web, worker, knowledge-worker | no | `deterministic-v1` | no | Provider model id. |
| `OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS` | web, worker, knowledge-worker | no | `384` | no | Vector dimensions. |
| `OSVA_KNOWLEDGE_EMBEDDING_API_KEY` | web, worker, knowledge-worker | optional | — | yes | OpenAI-compatible embedding key. |
| `OSVA_KNOWLEDGE_EMBEDDING_BASE_URL` | web, worker, knowledge-worker | optional | — | no | OpenAI-compatible base URL. |
| `OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS` | web, worker, knowledge-worker | no | — | no | Test-oriented escape hatch; prefer explicit provider in production. |

## Worker runtime / execution

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_TRUSTED_RUNTIME_ROOT` | worker | yes (worker) | — | no | Directory for trusted TypeScript agent bundles. Compose mounts `osva-trusted-runtime`; copy bundles here. |
| `OSVA_EXECUTION_LEASE_TTL_MS` | worker | no | `30000` | no | Execution lease TTL. Must exceed the heartbeat interval. |
| `OSVA_EXECUTION_HEARTBEAT_INTERVAL_MS` | worker | no | `10000` | no | Lease renewal interval. |
| `OSVA_EXECUTION_RECOVERY_POLL_MS` | worker | no | `5000` | no | Recovery ticker interval. |
| `OSVA_EXECUTION_RECOVERY_BATCH_LIMIT` | worker | no | `50` | no | Expired RUNNING scan batch. |
| `OSVA_TRANSPORT_REPAIR_BATCH_LIMIT` | worker | no | `50` | no | QUEUED/PENDING transport repair batch. |
| `OSVA_RUNTIME_CAPABILITY_SECRET` | worker | optional | — | yes | Remote HTTP runtime bridge authentication. |
| `OSVA_RUNTIME_CAPABILITY_HOST` | worker | no | `127.0.0.1` | no | Capability server bind host. |
| `OSVA_RUNTIME_CAPABILITY_PORT` | worker | no | `0` | no | `0` = ephemeral port. |
| `OSVA_RUNTIME_CAPABILITY_BASE_URL` | worker | optional | — | no | Advertised capability base URL. |
| `OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS` | worker | no | `false` | no | Operator opt-in for private REMOTE_HTTP targets. |
| `OSVA_CONTAINER_ENABLED` | worker | no | `false` | no | **Helm defaults to false.** Requires Docker Engine (not normal Kubernetes). |
| `OSVA_CONTAINER_NETWORK_MODE` | worker | no | `bridge` | no | Must not be `host`/`none` when container runtime enabled. |
| `OSVA_CONTAINER_CAPABILITY_BASE_URL` | worker | optional | — | no | Container capability bridge URL. |
| `OSVA_CONTAINER_DEFAULT_*` / `OSVA_CONTAINER_MAX_*` | worker | no | see worker config | no | Container resource policy limits. |

## Model providers (worker)

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OPENAI_API_KEY` | worker | optional | — | yes | OpenAI provider adapter. |
| `ANTHROPIC_API_KEY` | worker | optional | — | yes | Anthropic provider adapter. |
| `GOOGLE_GEMINI_API_KEY` | worker | optional | — | yes | Gemini provider adapter. |

## Connector secrets

Connector versions store `SecretReference` values. Resolve environment-backed references in web/worker/MCP process environments at execution time. Never commit secret values.

## OpenTelemetry

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OTEL_SERVICE_NAME` | all instrumented apps | no | process default (`osva-web`, `osva-worker`, `osva-scheduler`, `osva-workflow-orchestrator`, `osva-mcp`, `osva-knowledge-worker`) | no | Overrides the process default OTLP service name. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | all instrumented apps | optional | — | no | OTLP **HTTP** base URL (example `http://otel-collector:4318`). The adapter appends `/v1/traces` and `/v1/metrics`. Unset = no-op. |
| `OTEL_EXPORTER_OTLP_HEADERS` | all instrumented apps | optional | — | yes | `key=value` pairs, comma-separated (example `Authorization=Bearer …`). Secret. Never log. Helm: Secret / `secretEnv` only. |
| `OTEL_SDK_DISABLED` | all instrumented apps | no | — | no | When `true`, disables OTLP export. |
| `OTEL_TRACES_SAMPLER` | all instrumented apps | no | SDK default | no | `always_on`, `always_off`, `traceidratio`, `parentbased_always_on`, `parentbased_always_off`, `parentbased_traceidratio`. |
| `OTEL_TRACES_SAMPLER_ARG` | all instrumented apps | no | — | no | Ratio for `traceidratio` / `parentbased_traceidratio` (0–1). |

Compose overlay (`compose.observability.yml`) sets the internal endpoint
`http://otel-collector:4318` on application services. Helm `telemetry.enabled`
defaults to `false`. Community observability has no Team/Enterprise license
gate. See [`../architecture/OPENTELEMETRY.md`](../architecture/OPENTELEMETRY.md)
and `deploy/observability/README.md`.

## Database CLI

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_DATABASE_URL` | migrate, bootstrap | yes | — | yes | Same as application DSN. |
| `OSVA_BOOTSTRAP_WORKSPACE_NAME` | bootstrap | no | `Default Workspace` | no | First workspace name. |

Bootstrap prints a one-time ADMIN API key. Do not run bootstrap on every deployment.

## Container image process selector

| Variable | Processes | Required | Default | Sensitive | Notes |
|----------|-----------|----------|---------|-----------|-------|
| `OSVA_PROCESS` | OCI image entrypoint | yes in image | — | no | `web`, `worker`, `scheduler`, `workflow-orchestrator`, `knowledge-worker`, `mcp-server`, `migrate`, `bootstrap`. |
