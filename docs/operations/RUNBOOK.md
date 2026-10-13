# OSVA operations runbook (OSS 1.0)

Focused guidance for Community Edition operators. This is not an enterprise SRE handbook.

## Health endpoints

| Endpoint | Meaning |
|----------|---------|
| `GET /health` | Process liveness (no DB/Valkey required) |
| `GET /ready` | `200` when PostgreSQL and Valkey are reachable. `503` bodies may include `failedDependency` (`postgres` or `valkey`) or `failedDependencies` when both fail. No hostnames, URLs, or credentials. |

Web exposes these on `OSVA_WEB_PORT`. Worker, scheduler, workflow-orchestrator, and knowledge-worker expose them on `OSVA_HEALTH_PORT` (Compose/Helm: `8081`). Readiness must not succeed solely because the process exists.

## Web `/ready` failure

1. Read `failedDependency` / `failedDependencies` on the `503` body.
2. `postgres` — check connection string, TLS, credentials, and disk space. Do not confuse this with a Valkey outage.
3. `valkey` — check URL, network policy, and memory limits. Durable RunAttempt state in PostgreSQL may still be current while the queue is down.
4. Confirm migrations completed (`migrate` job / Compose one-shot). Journal-applied is not enough; see [schema drift](#migration-journal-versus-schema-drift) below.
5. After dependency recovery, restart web pods/processes and re-check `/ready`.
6. Authentication failures (`401`) are not rate-limit rejections (`429 RATE_LIMITED`). Do not treat them as the same operator incident.

## PostgreSQL unavailable

PostgreSQL is the **durable semantic and lifecycle authority**. Without it, control-plane APIs and orchestration cannot make progress.

- Verify connectivity from the web pod/container.
- Restore from backup if data directory is corrupt (see [`BACKUP_AND_RECOVERY.md`](BACKUP_AND_RECOVERY.md)).
- Do not run application rollback while the database is in an unknown migration state.

## Valkey unavailable

Valkey backs BullMQ transport only, but loss or outage blocks queue delivery and may strand in-flight transport work.

- Verify URL and network policies.
- Restart Valkey; confirm web `/ready` returns `200`.
- Restart worker, scheduler, workflow-orchestrator, and knowledge-worker after Valkey is healthy.

## Worker startup failure

1. Confirm `/ready` on web is `200` (worker uses the same core env vars).
2. Verify `OSVA_TRUSTED_RUNTIME_ROOT` exists and is readable in the worker container.
3. Check worker logs for `worker.started` and `"consuming":true`.
4. Validate model provider keys only if agents require external models (missing keys fail model calls, not necessarily startup).

## Trusted runtime root issues

Trusted TypeScript agents are loaded from operator-installed files under `OSVA_TRUSTED_RUNTIME_ROOT`. They are not uploaded via API.

- Mount a persistent volume in Kubernetes/Compose.
- Ensure file permissions allow the worker user to read entrypoints.
- After updating trusted files, restart workers (no hot reload guarantee).

## Migrations pending or failing

- Run the explicit migrate job (`OSVA_PROCESS=migrate` / Compose `migrate` / Helm hook Job).
- Inspect migrate logs; fix SQL connectivity before retrying.
- Use `pnpm db:migrations:status` and `pnpm db:migrations:integrity` against the same database from an operator workstation when debugging clones.

## Migration journal versus schema drift

`db:migrations:status` compares journal entry count to `drizzle.__drizzle_migrations`. That did not detect the M9 Batch 2 incident: the journal recorded `0023_execution_lease_slice`, but `run_attempts` lacked `execution_owner`, `execution_generation`, `lease_expires_at`, and/or `run_attempts_expired_lease_idx`.

`db:migrations:integrity` probes the physical catalog. Outcomes:

| Outcome | Meaning |
| --- | --- |
| `not_migrated` | 0023 is not applied and lease objects are absent |
| `applied_and_matches` | Journal claims 0023 and the lease columns/index match |
| `schema_mismatch` | Journal claims applied (or objects are wrong) but the catalog does not match |
| `schema_ahead` | Lease objects exist but the journal does not claim 0023 |
| `database_inaccessible` | PostgreSQL could not be reached |
| `unknown` | Catalog or journal state could not be classified |

**Do not automatically rerun `0023_execution_lease_slice.sql`.** A partially applied migration can have side effects beyond the missing objects. Naive replay can fail or leave the database inconsistent.

Safe investigation:

1. Take or verify a PostgreSQL backup.
2. Compare `information_schema.columns` and `pg_indexes` to the expected 0023 objects.
3. Compare `drizzle.__drizzle_migrations` row count to `packages/db/drizzle/meta/_journal.json`.
4. Perform an explicit, reviewed repair for the missing objects only after you understand why the journal and catalog diverged.
5. Re-run `db:migrations:integrity`. Do not rewrite migration files or hashes.

## Scheduler issues

- Confirm scheduler process is running and logs `scheduler.started`.
- Verify PostgreSQL connectivity (scheduler authority is PostgreSQL, not Valkey repeatable jobs).
- Check clock/timezone configuration for schedules.

## Workflow orchestrator issues

- Confirm `workflow_orchestrator.started` in logs.
- Inspect `WorkflowRun` / `WorkflowNodeRun` rows for stuck states.
- Verify worker is consuming execution queue for AGENT nodes.

## Knowledge ingestion problems

- Knowledge worker logs `knowledge_worker.started`.
- Embedding provider configuration must be consistent across web/worker/knowledge-worker.
- Ingestion failures surface in knowledge-worker logs and Run history for ingestion Runs.

## Artifact storage failure

- Filesystem mode requires a **shared** root across web and worker on the same host/volume.
- Production Helm defaults to **S3-compatible** storage; verify bucket credentials and endpoint.
- Artifact API errors often appear as `5xx` on artifact routes while `/health` remains `200`.

## MCP Host validation / 401 / 403 / 503

- `401` on MCP — missing/invalid API key for OSVA-backed auth context.
- `403` on `/mcp` — `Host` header not listed in `OSVA_MCP_ALLOWED_HOSTS`.
- `503` — upstream web unreachable from MCP server (`OSVA_API_BASE_URL`).
- `/health` ignores Host filtering (use for probes).

## API key bootstrap and replacement

- Initial workspace bootstrap prints a root API key once.
- Create additional keys via authenticated `/v1/api-keys` when supported by your deployment policy.
- Rotate by creating a new key, updating clients, then revoking old keys.

## Graceful shutdown and restart

- Send `SIGTERM` to processes; allow in-flight RunAttempts to reach terminal states where possible.
- Kubernetes: use rolling updates; ensure `preStop` hooks allow request drain if you add ingress proxies.

## Container runtime disabled / unavailable

- `OSVA_CONTAINER_ENABLED=false` is the default in Helm and Compose.
- CONTAINER runtime targets **Docker Engine** on the worker host; it is not a Kubernetes-native executor.
- Enabling container runs requires explicit operator configuration and a reachable Docker socket (not enabled by default).

## Telemetry

- OpenTelemetry is optional; configure exporters per [`../contracts/TELEMETRY_CONTRACT.md`](../contracts/TELEMETRY_CONTRACT.md).
- Missing telemetry configuration does not block core execution. No-op mode is supported for every process, including MCP and knowledge-worker.
- Enable Compose observability with
  `docker compose -f compose.yml -f compose.observability.yml up -d`.
  Default Compose does not point applications at a collector.
- Helm: `telemetry.enabled=false` by default. Point `telemetry.otlpEndpoint` at
  an external Collector. Do not put `OTEL_EXPORTER_OTLP_HEADERS` in a ConfigMap.
- Example dashboards and alerts: `deploy/observability/`. Import Grafana JSON
  against a Prometheus datasource with uid `prometheus`.
- Verify export: scrape the Collector Prometheus endpoint (Compose internal
  `otel-collector:8889`) and confirm `osva_http_requests_total` — not
  `osva.http.requests`.
- Collector outage: execution and `/ready` continue. Telemetry is delayed or
  dropped. Do not add the Collector to application readiness.
- Sampling: `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`.
- Retention: example Prometheus uses `OSVA_METRICS_RETENTION` (default 15d).
- Privacy: metadata only at the application. Collector redaction cannot repair
  secrets already exported.

## API 5xx rate

1. Confirm `GET /ready` and `failedDependency` (`postgres` vs `valkey`).
2. Inspect `osva_http_requests_total{status_class="5xx"}` by `route_family`.
3. Distinguish `401` authentication failures from `429 RATE_LIMITED` and
   `503` limiter-store outages (`osva_security_events_total`).

## Queue backlog

Queue depth is BullMQ transport, not durable RunAttempt state. Check
`osva_queue_jobs{state="waiting"}` then PostgreSQL `run_attempts.status`.
A large waiting gauge with healthy attempt rows usually means workers are
down, not that work was lost.

## Missing worker consumers

OSVA does not export a consumer-count metric. The example alert uses
waiting > 0 and active == 0. Confirm worker `/ready` and queue consumption
logs (`consuming: true`).

## Worker stalls

`osva_queue_stalled_total` increments when BullMQ marks a job stalled.
Check worker crashes, lease TTL vs heartbeat, and Valkey load.

## Lease interruptions

`osva_recovery_lease_interrupted_total` is CAS-won recovery only. The same
RunAttempt fails with `EXECUTION_INTERRUPTED`. See
[`EXECUTION_RECOVERY.md`](EXECUTION_RECOVERY.md).

## Recovery ticker failures

`osva_recovery_errors_total` is not a successful transport repair.
`osva_recovery_transport_repaired_total` increments only for
`enqueue` outcome `enqueued`.

## Rate-limit store outage

`osva_security_events_total{event="rate_limit.store_unavailable"}` and HTTP
`503 SERVICE_UNAVAILABLE` mean Valkey (limiter store) failed closed. This is
not `429 RATE_LIMITED`.

## Collector outage

Application processes fail open. If you scrape `job=osva-otel-collector`,
`up == 0` means telemetry is stale. Execution must keep running.

## Dependency unavailability

`/ready` is not a Prometheus metric (probes are excluded from HTTP
telemetry). Use process probes and the `failedDependency` JSON body.

## Console request-guard rejections

Community Console emits bounded security events for invalid Host, invalid Origin, cross-site mutations, and oversized JSON bodies. Events do not include raw Host/Origin strings or `OSVA_CONSOLE_API_KEY`. Valid same-origin Console requests are unchanged.
