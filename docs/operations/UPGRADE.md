# OSVA upgrade runbook (Community Edition)

Supported upgrade path for self-hosted Compose and Kubernetes deployments.

## Version lines

| From | To | SQL migrations |
|------|-----|----------------|
| Published git tag **`v1.0.0`** | **`1.1.0-rc.2`** (and 1.1.x) | Requires **`0023_execution_lease_slice`** (tag `v1.0.0` ends at **`0022_api_security_slice`**) |
| Already on **`1.1.0-rc.1`** or **`1.1.0-rc.2`** schema head | Later 1.1.x RC/GA | Apply any new append-only migrations after **`0023`** |
| Any **`0023`** database | M11 human auth head | Through **`0026_better_auth_user_image`** (`0024` identity, `0025` human auth, `0026` user image) |
| M12–M14 Community line (**`1.1.0-rc.4`** / **`1.1.0`**) | Same line (no new migrations in M15) | Head **`0030_approval_operation_binding_slice`** (`0027`–`0030`; see below) |
| **`1.1.0-rc.4`** published artifacts | **`1.1.0`** stable | **Drop-in** image/npm/PyPI version bump when all aligned packages move together; schema already at **`0030`** |

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

### Migrations `0024`–`0026` (M11 human identity and authentication)

Append-only migrations after **`0023`**. They do not remove or rewrite API keys, Runs, or workflow data.

| Migration | Operator note |
| --- | --- |
| **`0024_identity_foundation_slice`** | Adds organizations, users, memberships, audit; nullable `workspaces.organization_id` |
| **`0025_human_authentication_slice`** | Better Auth session/account tables; `PENDING_SETUP` user status |
| **`0026_better_auth_user_image`** | Nullable `users.image` |

**After migrate to head:**

1. Set **`OSVA_AUTH_SECRET`** (≥ 32 characters) on **`apps/web`** before enabling human login.
2. Set **`OSVA_AUTH_BASE_URL`** to the public web URL and **`OSVA_AUTH_TRUSTED_ORIGINS`** to include Console browser origins (see [`.env.example`](../../.env.example)).
3. Run **`pnpm identity:bootstrap`** once per environment (or `OSVA_PROCESS=identity-bootstrap` in the OCI image). Save the one-time setup token from stdout.
4. Complete setup via **`POST /v1/auth/setup/complete`** or Console **`/setup`**.
5. Start Console in default human-session mode (**no** `OSVA_CONSOLE_API_KEY`). Optional legacy BFF: `OSVA_CONSOLE_LEGACY_API_KEY_MODE=true`.

Existing workspace API keys remain valid for CLI, SDK, and MCP. See [`M11_CLOSEOUT_SUMMARY.md`](M11_CLOSEOUT_SUMMARY.md).

### Migrations `0027`–`0028` (M12 model connections and M13 playground)

Append-only migrations after **`0026`**. They do not remove Runs, workflow data, or API keys.

| Migration | Operator note |
| --- | --- |
| **`0027_model_provider_connections`** | Model provider connection registry tables for self-hosted and external model endpoints (M12.1) |
| **`0028_playground_memory_restriction`** | Playground/evaluation memory restriction metadata (M13.7) |

### Migration `0029_evaluation_quality_gate_slice` (M13.7.5)

Introduced for batch evaluation **quality gate** persistence. Adds:

- Nullable `evaluation_runs.quality_gate_policy` (jsonb)
- Table `evaluation_run_gate_assessments` (one row per terminal evaluation run assessment)

**Operator steps after `0029`:**

1. Run migrate before rolling **web** and **worker** (evaluation runs and assessments are written through control-plane APIs and child Runs).
2. Run `pnpm db:migrations:status` and `pnpm db:migrations:integrity` — journal head should include **`0029_evaluation_quality_gate_slice`**.
3. Existing evaluation runs without a gate policy behave as before; assessments appear only when a suite launch supplied `qualityGatePolicy` and the run reached a terminal coordinator state.

See [`M13_7_5_CLOSEOUT_SUMMARY.md`](M13_7_5_CLOSEOUT_SUMMARY.md).

### Migration `0030_approval_operation_binding_slice` (M14.5)

Introduced for **operation-bound workflow approvals**. Adds nullable columns on `approval_requests`:

- `operation_kind` (text)
- `operation_digest` (text)
- `expires_at` (timestamptz)

**Operator steps after `0030`:**

1. Run migrate before rolling **web**, **worker**, and **workflow-orchestrator** (approval creation and resume verify bindings in domain + orchestration).
2. Run `pnpm db:migrations:integrity` — journal head should include **`0030_approval_operation_binding_slice`**.
3. **Legacy rows:** Approval requests created before **`0030`** may have null binding columns; decide/resume paths skip digest verification for those rows (see [`M14_5_ACCEPTANCE_SUMMARY.md`](M14_5_ACCEPTANCE_SUMMARY.md)).
4. **Forward-only:** Do not downgrade application binaries to builds that predate M14.5 after **`0030`** is applied unless you accept unsupported schema/application skew.

Repository journal head (**`1.1.0`** stable preparation, RC.4 tag **`v1.1.0-rc.4`** and later): **`0030_approval_operation_binding_slice`**. Verify with `pnpm db:migrations:verify`.

## Runtime behavior changes (1.1.x)

- Execution leases and fencing on RunAttempt; heartbeats renew leases in PostgreSQL time.
- BullMQ remains transport; queue redelivery reuses the same RunAttemptId.
- HTTP abuse rate limits: **`429 RATE_LIMITED`**; Valkey outage on protected paths → **`503 SERVICE_UNAVAILABLE`** (fail-closed).
- Optional RunAttempt **`execution`** diagnostics on GET attempt resources (additive JSON).

## Helm

1. Update chart `version` / `appVersion` and image tag to the target release (for example **`1.1.0`** from root `VERSION`; for RC pins see [`../release/RC4_VERIFICATION.md`](../release/RC4_VERIFICATION.md)).
2. Run `helm upgrade` — the chart migration Job hook runs before workloads when enabled.
3. Run bootstrap only for **new** environments (not on every upgrade).
4. Roll Deployments if hook jobs do not restart apps automatically.

## Compose

1. Pull the new image tag (`OSVA_IMAGE`, for example `ghcr.io/osva-ai/osva:1.1.0` after stable publication, or `:1.1.0-rc.4` for RC).
2. `docker compose run --rm migrate`
3. `docker compose up -d` to recreate app services.

### CLI-managed installations (`osva platform upgrade`)

For installations created with `osva setup`, prefer explicit lifecycle commands over ad-hoc Compose:

```bash
osva platform upgrade --to 1.1.1 --dry-run
# After PostgreSQL + artifact backups (manual — see BACKUP_AND_RECOVERY.md):
osva platform upgrade --to 1.1.1 --backup-confirmed --yes
```

**From platform `1.1.0` → `1.1.1` (M16):** no new SQL migrations; the CLI replaces the compose template to add Console and installation-status services. Requires npm **`@osva-ai/cli@1.1.2`** (or newer 1.1.x distribution) with bundled catalog paths.

- `--dry-run` is read-only and prints the planned image change, migration expectation, backup requirements, and blocking issues.
- `--backup-confirmed` is operator attestation only; OSVA does not verify backups or restore them.
- `--yes` confirms execution; it does **not** bypass backup attestation.
- Upgrades refuse downgrades and unknown version paths (see bundled `upgrade-catalog.json` in the CLI).
- Interrupted upgrades persist non-secret state under `.osva/upgrade-state.json` for diagnosis. Application rollback and database rollback are not equivalent; see recovery notes in this runbook.

Day-to-day start/stop/restart remains `osva platform start|stop|restart` (no implicit pull or migrate).

## Verification

- `GET /ready` returns `200` on web (may name `postgres` and/or `valkey` on failure without leaking secrets).
- Worker logs show queue consumption and recovery ticker activity.
- Authenticated `/v1` request succeeds with a valid API key (machine plane unchanged).
- Optional: human login via Console or `POST /v1/auth/login` after bootstrap and setup.
- Optional: `pnpm release:acceptance` on a disposable environment (kind optional via `OSVA_KIND_ACCEPTANCE=true`).

## Rollback limitations

- Forward-only schema: downgrading to **`v1.0.0`** application images after **`0023`** applied is **unsupported**.
- Artifact bytes and PostgreSQL are not atomically backed up by OSVA; plan cross-store recovery explicitly ([`BACKUP_AND_RECOVERY.md`](BACKUP_AND_RECOVERY.md)).
