# Local contributor stack (Windows PowerShell)

Optional helpers for **Journey B** ([`docs/engineering/LOCAL_DEVELOPMENT.md`](../../docs/engineering/LOCAL_DEVELOPMENT.md)): Docker infra via root `docker-compose.yml`, OSVA apps on the host.

## PostgreSQL host port

Default published port is **5432**. If another service uses 5432 on your machine:

1. Set `OSVA_POSTGRES_HOST_PORT=5433` (or add it to gitignored root `.env`) before `pnpm infra:up`, **or** copy [`docker-compose.override.example.yml`](../../docker-compose.override.example.yml) to `docker-compose.override.yml` (uses Compose `!override` so only one host port is published).
2. Dot-source [`load-contributor-env.ps1`](./load-contributor-env.ps1) (or export matching `OSVA_DATABASE_URL`) so apps use the same port.

Do not combine an override port mapping with a conflicting `OSVA_POSTGRES_HOST_PORT`. Changing the port mapping may require a one-time `docker compose up -d` reconcile; routine work should not recreate volumes.

## Scripts

| Script | Purpose |
| --- | --- |
| `load-contributor-env.ps1` | Export core contributor env vars; reads gitignored `.osva/*` secrets without printing them |
| `start-contributor-stack.ps1` | Start web, worker, scheduler, workflow-orchestrator with logs under `.osva/logs/` |
| `stop-contributor-stack.ps1` | Stop only processes recorded in `.osva/stack.pids.json` with identity checks |
| `run-contributor-service.ps1` | Single-service launcher (`-File`); loads env without secrets on the command line |
| `contributor-stack-process.ps1` | Shared helpers (dot-source only) |

Run from any directory; scripts resolve the repository root from `$PSScriptRoot`.

### REMOTE_HTTP local development

Private-network exceptions are **opt-in**:

```powershell
. .\scripts\local\load-contributor-env.ps1 -RemoteHttpDev
# or: $env:OSVA_REMOTE_HTTP_DEV_PROFILE = "true" before loading env
.\scripts\local\start-contributor-stack.ps1 -RemoteHttpDev
```

See [`docs/engineering/REMOTE_HTTP_LOCAL_AGENT_SETUP.md`](../../docs/engineering/REMOTE_HTTP_LOCAL_AGENT_SETUP.md).

## Safety

- Stop logic never targets the invoking PowerShell or its parent chain.
- Managed PIDs are validated (command line, repo path, service marker, start time) before termination.
- Descendant processes are stopped only when their command line matches the OSVA repo or `@osva/` filters.
- Do not assign to `$PID` in custom wrappers; use `$wrapperPid` or similar (PowerShell’s automatic `$PID` is the current shell).
- Managed wrappers start with `powershell -File run-contributor-service.ps1` only (no `-Command` strings). Authentication and capability secrets are loaded inside the child from gitignored `.osva/*` via `load-contributor-env.ps1`, not passed as process arguments.

Regression: `node --test scripts/local/contributor-stack.security.test.mjs`

## Migration journal drift

If migrate fails with existing objects but a missing journal row, use `pnpm db:migrations:integrity` and follow [`docs/operations/RUNBOOK.md`](../../docs/operations/RUNBOOK.md) — explicit reviewed repair only, never automatic journal edits in these scripts.

Local recovery example: [`docs/engineering/LOCAL_MIGRATION_RECOVERY_CASES.md`](../../docs/engineering/LOCAL_MIGRATION_RECOVERY_CASES.md).
