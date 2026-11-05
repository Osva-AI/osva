# Local migration recovery cases

Operator-facing recovery lives in [`../operations/RUNBOOK.md`](../operations/RUNBOOK.md) and [`../operations/UPGRADE.md`](../operations/UPGRADE.md). This note records **contributor-local** incidents for searchability; it is not a substitute for the runbook.

## Case: journal missing 0023 while lease columns exist (Windows contributor host)

**Symptoms**

- `pnpm db:migrate` failed because objects from `0023_execution_lease_slice` already existed.
- `pnpm db:migrations:integrity` reported **`schema_ahead`**: physical lease columns / index present, Drizzle journal did not claim 0023.

**Context**

- Long-lived local PostgreSQL volume on root `docker-compose.yml` (not a fresh `docker compose down -v`).
- Likely partial or out-of-band application of 0023 SQL without a matching `drizzle.__drizzle_migrations` row.

**Recovery (manual, reviewed)**

1. Verified backup / acceptable data loss scope for a dev machine.
2. Compared catalog objects to `packages/db/drizzle/0023_execution_lease_slice.sql` and journal entries in `packages/db/drizzle/meta/_journal.json`.
3. Inserted the missing journal row for 0023 **only after** confirming physical objects matched the migration (explicit SQL review; not automated in repo tooling).
4. Re-ran `pnpm db:migrate` to apply 0024–0030 sequentially.
5. Confirmed `pnpm db:migrations:integrity` → **`applied_and_matches`** (or current head per release docs).

**Out of scope for automation**

- Repository scripts must **not** auto-insert or delete `drizzle.__drizzle_migrations` rows.
- Do not edit historical migration files or manifest hashes to “fix” local state.

**Prevention**

- Always run migrate from a shell with the same `OSVA_DATABASE_URL` as running apps.
- After upgrades, run both `pnpm db:migrations:status` and `pnpm db:migrations:integrity`.
