# Self-hosted Docker Compose

Production-oriented single-host topology for OSVA Community Edition. Uses one OSVA OCI image for every application process.

This directory is the **external agent developer** journey (full stack in Docker). OSVA contributors run only PostgreSQL and Valkey from the repository root; see [`../../docs/engineering/LOCAL_DEVELOPMENT.md`](../../docs/engineering/LOCAL_DEVELOPMENT.md).

## Prerequisites

- Docker Engine with Compose v2
- Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`
- **Shell exports beat env files:** host `OSVA_VALKEY_URL` overrides `.env` and `--env-file` during Compose interpolation. Keep **`OSVA_VALKEY_URL=redis://valkey:6379`** in `.env` **and** unset contributor host exports before `docker compose up`, or containers may target `127.0.0.1:6379` and `/ready` returns **503**.

## Start

```bash
docker compose up -d --build
```

Ordering:

1. PostgreSQL and Valkey become healthy
2. `migrate` runs once and must succeed
3. Application services start

Migrations are **not** run automatically on application startup.

## Bootstrap (one-time)

Creates the first workspace and ADMIN API key. Not part of normal `up`.

```bash
docker compose --profile bootstrap run --rm bootstrap
```

Copy the printed `osva_ak_…` token immediately.

## Health

- Web: `http://localhost:${OSVA_PUBLISH_WEB_PORT:-8080}/health` and `/ready`
- MCP: `http://localhost:${OSVA_PUBLISH_MCP_PORT:-3100}/health`
- Worker, scheduler, workflow-orchestrator, and knowledge-worker: container `GET /health` and `/ready` on port `8081` (dependency checks, not process existence)

Optional Valkey AUTH: set `VALKEY_PASSWORD` and `OSVA_VALKEY_URL=redis://:password@valkey:6379`. Leave both unset for the default no-auth topology. Do not log connection strings.

Console is not part of this Compose file.

## Observability (optional)

Default `up` does **not** start a collector and does **not** set
`OTEL_EXPORTER_OTLP_ENDPOINT`. Processes stay in no-op telemetry mode.

Compose profiles cannot condition environment variables on other services, so
observability is an overlay, not `--profile observability`:

```bash
docker compose -f compose.yml -f compose.observability.yml up -d
```

That command starts `otel-collector`, example Prometheus, and Grafana, and
points web/worker/scheduler/workflow-orchestrator/knowledge-worker/mcp-server
at `http://otel-collector:4318`. Application containers do not `depends_on`
the collector; a collector crash does not fail OSVA execution.

- OTLP (`4317`/`4318`) and Prometheus scrape (`8889`) are internal only.
- Grafana binds `127.0.0.1:${OSVA_PUBLISH_GRAFANA_PORT:-3001}`.
- Dashboards and alerts: [`../observability/README.md`](../observability/README.md).
- Optional `OTEL_EXPORTER_OTLP_HEADERS` belongs in the environment/secret, not
  Compose logs.

## Notes

- PostgreSQL and Valkey are on the internal Compose network only (not published by default).
- Filesystem artifact storage uses the shared `osva-artifacts` volume across Web, Worker, and Knowledge Worker.
- Container agent runtime (`OSVA_CONTAINER_ENABLED`) defaults to `false` (Docker Engine is not bundled).
