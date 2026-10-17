# OSVA upgrade runbook (Community Edition)

Supported upgrade path for self-hosted Compose and Kubernetes deployments.

## Version lines

| From | To | SQL migrations |
|------|-----|----------------|
| Published git tag **`v1.0.0`** | **`1.1.0-rc.2`** (and 1.1.x) | Requires **`0023_execution_lease_slice`** (tag `v1.0.0` ends at **`0022_api_security_slice`**) |
| Already on **`1.1.0-rc.1`** or **`1.1.0-rc.2`** schema head | Later 1.1.x RC/GA | Apply any new append-only migrations after **`0023`** |

See [`../release/COMPATIBILITY.md`](../release/COMPATIBILITY.md) and [`CHANGELOG.md`](../../CHANGELOG.md).

## Procedure

```text
backup PostgreSQL (and artifact store per your DR plan)
  → review CHANGELOG / release notes
  → pnpm db:migrations:status (or equivalent against production URL)
  → pull/build OCI image and/or Helm chart for target VERSION
  → run migrations (explicit job — never rely on app auto-migrate)
  → pnpm db:migrations:integrity (schema probe for 0023 lease objects)
  → roll web, worker, scheduler, workflow-orchestrator, knowledge-worker, mcp-server
  → verify /ready and authenticated /v1
  → reconcile legacy unleased RUNNING RunAttempts if upgrading to 1.1.x
```

## Database migrations

- Historical SQL under `packages/db/drizzle/` is **append-only**. Existing migration files are never rewritten.
- Migrations are **forward** operations. OSVA does not promise automatic database downgrade.
- Application rollback (previous image) and database rollback are **not equivalent**. Rolling back application binaries without matching schema expectations is unsupported.
- Take a PostgreSQL backup before upgrading production.
- After migrate, run `pnpm db:migrations:status` **and** `pnpm db:migrations:integrity`. A current journal row is not proof the 0023 lease columns and `run_attempts_expired_lease_idx` exist.
- If integrity reports `schema_mismatch`, do **not** blindly replay `0023_execution_lease_slice.sql`. Back up, compare catalog vs journal, then apply an explicit reviewed repair. See [`RUNBOOK.md`](RUNBOOK.md).

### Migration `0023_execution_lease_slice` (1.0.0 → 1.1.x)

Introduced after tag **`v1.0.0`**. Adds:

- `execution_owner` (nullable text)
- `execution_generation` (integer, default `0`)
- `lease_expires_at` (nullable timestamptz)
- Partial index `run_attempts_expired_lease_idx` on expired leased `RUNNING` rows

**Operator steps after 0023:**

1. Run migrate Job / `pnpm db:migrate` before rolling **workers** (workers host lease recovery).
2. Run `pnpm db:migrations:integrity` against the production database URL.
3. List legacy rows: `status = 'RUNNING' AND execution_owner IS NULL`.
4. Confirm no worker still owns each attempt; fail settled rows with an operator UPDATE or accept manual settlement. See [`EXECUTION_RECOVERY.md`](EXECUTION_RECOVERY.md).
5. Expect **`EXECUTION_INTERRUPTED`** on attempts whose lease expires while workers crash or stall — OSVA does **not** auto-start a new logical RunAttempt for crash recovery.

## Runtime behavior changes (1.1.x)

- Execution leases and fencing on RunAttempt; heartbeats renew leases in PostgreSQL time.
- BullMQ remains transport; queue redelivery reuses the same RunAttemptId.
- HTTP abuse rate limits: **`429 RATE_LIMITED`**; Valkey outage on protected paths → **`503 SERVICE_UNAVAILABLE`** (fail-closed).
- Optional RunAttempt **`execution`** diagnostics on GET attempt resources (additive JSON).

## Helm

1. Update chart `version` / `appVersion` and image tag to the target release (for example **`1.1.0-rc.2`** from root `VERSION`).
2. Run `helm upgrade` — the chart migration Job hook runs before workloads when enabled.
3. Run bootstrap only for **new** environments (not on every upgrade).
4. Roll Deployments if hook jobs do not restart apps automatically.

## Compose

1. Pull the new image tag (`OSVA_IMAGE`, for example `ghcr.io/osva-ai/osva:1.1.0-rc.2`).
2. `docker compose run --rm migrate`
3. `docker compose up -d` to recreate app services.

## Verification

- `GET /ready` returns `200` on web (may name `postgres` and/or `valkey` on failure without leaking secrets).
- Worker logs show queue consumption and recovery ticker activity.
- Authenticated `/v1` request succeeds with a valid API key.
- Optional: `pnpm release:acceptance` on a disposable environment (kind optional via `OSVA_KIND_ACCEPTANCE=true`).

## Rollback limitations

- Forward-only schema: downgrading to **`v1.0.0`** application images after **`0023`** applied is **unsupported**.
- Artifact bytes and PostgreSQL are not atomically backed up by OSVA; plan cross-store recovery explicitly ([`BACKUP_AND_RECOVERY.md`](BACKUP_AND_RECOVERY.md)).
