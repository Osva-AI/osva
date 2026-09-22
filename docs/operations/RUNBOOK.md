# OSVA operations runbook (OSS 1.0)

Focused guidance for Community Edition operators. This is not an enterprise SRE handbook.

## Health endpoints

| Endpoint | Meaning |
|----------|---------|
| `GET /health` | Process liveness (no DB/Valkey required) |
| `GET /ready` | `200` when PostgreSQL and Valkey are reachable |

## Web `/ready` failure

1. Check PostgreSQL: connection string, TLS, credentials, disk space.
2. Check Valkey: URL, network policy, memory limits.
3. Inspect web logs for `database` or `valkey` connection errors.
4. Confirm migrations completed (`migrate` job / Compose one-shot).
5. After dependency recovery, restart web pods/processes and re-check `/ready`.

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
- Use `pnpm db:migrations:status` against the same database from an operator workstation when debugging dev clones.

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
- Missing telemetry configuration does not block core execution.
