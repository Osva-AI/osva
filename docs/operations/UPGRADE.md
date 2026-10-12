# OSVA upgrade runbook (OSS 1.0)

Supported upgrade path for self-hosted and Kubernetes deployments.

## Procedure

```text
backup
  → review release notes / CHANGELOG
  → verify migration status on the target database
  → pull new OCI image and/or Helm chart
  → run migrations (explicit job)
  → roll application services
  → verify /ready and smoke authenticated /v1
```

## Database migrations

- Historical SQL under `packages/db/drizzle/` is **append-only**. Existing migration files are never rewritten.
- Migrations are **forward** operations. OSVA does not promise automatic database downgrade.
- Application rollback (previous image) and database rollback are **not equivalent**. Rolling back application binaries without matching schema expectations is unsupported.
- Take a PostgreSQL backup before upgrading production.
- `0023_execution_lease_slice` adds nullable `execution_owner` / `lease_expires_at` and `execution_generation` default `0`. Existing `RUNNING` rows without a lease are **not** auto-failed. After upgrade, list `run_attempts` where `status = 'RUNNING' AND execution_owner IS NULL`, confirm no worker still owns them, then fail those rows with an operator UPDATE. See [`EXECUTION_RECOVERY.md`](EXECUTION_RECOVERY.md).

## Helm

1. Update chart `version` / `appVersion` and image tag to the target release (for example `1.0.0`).
2. Run `helm upgrade` — the chart migration Job hook runs before workloads when enabled.
3. Run bootstrap only for **new** environments (not on every upgrade).
4. Roll Deployments if hook jobs do not restart apps automatically.

## Compose

1. Pull/build the new image tag (`OSVA_IMAGE`).
2. `docker compose run --rm migrate`
3. `docker compose up -d` to recreate app services.

## Verification

- `GET /ready` returns `200` on web.
- Worker logs show queue consumption.
- Authenticated `/v1` request succeeds with a valid API key.
- Optional: run repository acceptance scripts documented in [`../implementation/STAGE-3-8-DEPLOYMENT.md`](../implementation/STAGE-3-8-DEPLOYMENT.md).
