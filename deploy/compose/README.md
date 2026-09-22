# Self-hosted Docker Compose

Production-oriented single-host topology for OSVA Community Edition. Uses one OSVA OCI image for every application process.

## Prerequisites

- Docker Engine with Compose v2
- Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`

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

## Notes

- PostgreSQL and Valkey are on the internal Compose network only (not published by default).
- Filesystem artifact storage uses the shared `osva-artifacts` volume across Web, Worker, and Knowledge Worker.
- Container agent runtime (`OSVA_CONTAINER_ENABLED`) defaults to `false` (Docker Engine is not bundled).
