# Local development journeys

Two supported local topologies share the same product sequence but differ in **where OSVA runs** and **which Compose file you use**.

| Journey | Who | OSVA processes | Infrastructure Compose | Working directory |
| --- | --- | --- | --- | --- |
| **A. External agent developer** | Build agents against a self-hosted stack without running OSVA from source | Docker (`deploy/compose/compose.yml`) | Bundled in `deploy/compose` (PostgreSQL, Valkey, migrate, web, worker, …) | `deploy/compose` for Compose; any directory for `@osva-ai/cli` projects |
| **B. OSVA contributor** | Change OSVA itself in this repository | Host (`pnpm dev:*` from the monorepo) | Root [`docker-compose.yml`](../../docker-compose.yml) (PostgreSQL and Valkey only) | Repository root for `pnpm infra:*`, `pnpm db:*`, and `pnpm build`; separate terminals for each app |

Historical guides ([`OSS-1.0-QUICKSTART.md`](../OSS-1.0-QUICKSTART.md), [`COMMUNITY-BETA-QUICKSTART.md`](../COMMUNITY-BETA-QUICKSTART.md)) describe earlier release lines. **Published `1.1.0-rc.1` npm/PyPI/GHCR artifacts** match that tag; behavior added on `main` after the tag requires **building from this repository** (or a newer commit), not assuming the published CLI/SDK already includes it.

Authoritative self-hosted operator path for journey **A**: [`OSS-COMMUNITY-QUICKSTART.md`](../OSS-COMMUNITY-QUICKSTART.md). CLI details: [`../../packages/cli/README.md`](../../packages/cli/README.md).

---

## Environment variables (both journeys)

OSVA application processes **do not auto-load** `.env`. Copy [`.env.example`](../../.env.example) (contributor) or [`deploy/compose/.env.example`](../../deploy/compose/.env.example) (Compose distribution) as a reference, then **export the variables in every shell** that runs an OSVA process, CLI session, or example script.

Opening a new terminal does not inherit values unless you set them again (PowerShell profile, `direnv`, or manual export).

### Contributor path resolution (`pnpm dev:*`)

`pnpm --filter @osva/web dev` (and worker, scheduler, orchestrator, knowledge-worker) runs Node with the **package directory as the process working directory** (for example `apps/worker`), not the repository root.

Relative values such as `./trusted-runtime` or `.osva/artifacts` in `.env.example` are therefore resolved against `apps/web` or `apps/worker`, not against the clone root. **Use absolute paths** shared by web and worker on one machine:

PowerShell (run from repository root; adjust drive/path):

```powershell
$RepoRoot = (Get-Location).Path
$env:OSVA_TRUSTED_RUNTIME_ROOT = Join-Path $RepoRoot "trusted-runtime"
$env:OSVA_ARTIFACT_FILESYSTEM_ROOT = Join-Path $RepoRoot ".osva\artifacts"
```

Bash:

```bash
REPO_ROOT="$(pwd)"
export OSVA_TRUSTED_RUNTIME_ROOT="$REPO_ROOT/trusted-runtime"
export OSVA_ARTIFACT_FILESYSTEM_ROOT="$REPO_ROOT/.osva/artifacts"
```

Create the trusted-runtime directory before starting the worker if it does not exist.

---

## Shared sequence

Both journeys follow this order (migrations may be implicit in full Compose `up`):

```text
prerequisites
    → configuration (env in each shell)
    → infrastructure / startup
    → migrations (if not already applied)
    → deliberate bootstrap (one-time API key)
    → optional doctor / readiness checks
    → deterministic first agent
    → inspect Run in Product Console
```

Bootstrap prints **`Workspace ID:`** and the **`osva_ak_…`** token once. Use that workspace id when a tool requires `OSVA_WORKSPACE_ID` (for example `pnpm example:hello`). **`@osva-ai/cli` deploy/run/status** resolve workspace from the API key via `/v1/auth/context`; **`OSVA_WORKSPACE_ID` is optional** there and must match the key if set.

Do not use a placeholder such as `ws-dev` as if bootstrap created it; new workspaces receive a server-generated id (UUID from host bootstrap).

---

## Journey A — External agent developer

**Goal:** Run the full Community stack in Docker and develop agents on the host with npm-installed or locally built `@osva-ai/cli`.

### 1. Prerequisites

- Docker Engine with Compose v2
- Node.js 24 + pnpm 12 (for repository examples) or Node 24 + npm (for standalone CLI projects)
- Optional: Python 3.11+ for Python SDK examples

### 2. Configuration

```powershell
cd path\to\osva\deploy\compose
Copy-Item .env.example .env
# Edit .env: set POSTGRES_PASSWORD (required)
```

```bash
cd /path/to/osva/deploy/compose
cp .env.example .env
# Set POSTGRES_PASSWORD in .env
```

Compose reads `deploy/compose/.env` automatically for **container** configuration. Host-side CLI still needs **`OSVA_BASE_URL`**, **`OSVA_API_KEY`**, and (for Compose trusted runtime) **`OSVA_COMPOSE_DIR`** exported in your shell.

**Important (Compose variable precedence):** For `${OSVA_VALKEY_URL}` (and other interpolated keys in `compose.yml`), **exported host shell variables override values from `docker compose --env-file` and from `deploy/compose/.env`**. Putting `OSVA_VALKEY_URL=redis://valkey:6379` only in an env file does **not** help if your shell still exports `redis://127.0.0.1:6379` for journey B — **unset** the host variable or open a clean shell before `docker compose up`. See [`../../deploy/compose/.env.example`](../../deploy/compose/.env.example).

### 3. Infrastructure and startup

From `deploy/compose`:

```bash
docker compose up -d --build --wait
```

This starts PostgreSQL, Valkey, the one-shot `migrate` job, and application containers. Web is published at **`http://127.0.0.1:${OSVA_PUBLISH_WEB_PORT:-8080}`** (default port **8080**).

To run migrations alone: `docker compose run --rm migrate`.

### 4. Bootstrap

```bash
docker compose --profile bootstrap run --rm bootstrap
```

Copy **`Workspace ID:`** and the API key from the output.

### 5. Doctor (optional)

From npm (published RC):

```bash
npm install -g @osva-ai/cli@1.1.0-rc.1
export OSVA_BASE_URL=http://127.0.0.1:8080
export OSVA_API_KEY='osva_ak_…'
osva doctor
```

Or build CLI from this repository (`pnpm --filter @osva-ai/cli build`) and run `node packages/cli/dist/bin/osva.js doctor`.

### 6. Deterministic first agent

**Standalone CLI project** (no `OSVA_WORKSPACE_ID` required if omitted):

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:8080"
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_TRUSTED_RUNTIME_MODE = "compose"
$env:OSVA_COMPOSE_DIR = "C:\path\to\osva\deploy\compose"
osva deploy
osva run --wait --input-file run-input.json
```

**Repository hello agent** (requires bootstrap **`Workspace ID`**):

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:8080"
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_WORKSPACE_ID = "<Workspace ID from bootstrap>"
$env:OSVA_HELLO_TRUSTED_RUNTIME_MODE = "compose"
cd C:\path\to\osva
pnpm install
pnpm example:hello
```

See [`../../examples/hello-agent/README.md`](../../examples/hello-agent/README.md).

### 7. Product Console

Console is **not** in Compose. On the host, point the console server at the **published** web URL:

| Variable | Compose stack |
| --- | --- |
| `OSVA_BASE_URL` | `http://127.0.0.1:8080` (or your `OSVA_PUBLISH_WEB_PORT`) |
| `OSVA_CONSOLE_API_KEY` | Bootstrap `osva_ak_…` (server-side only; never in the browser) |

Development (Vite + BFF):

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:8080"
$env:OSVA_CONSOLE_API_KEY = "osva_ak_…"
cd C:\path\to\osva
pnpm dev:console
```

Open **`http://127.0.0.1:5173`** (Vite). API traffic is proxied to the console server (default **`127.0.0.1:4174`**).

Production-style console server after build:

```bash
pnpm --filter @osva/console build
OSVA_BASE_URL=http://127.0.0.1:8080 OSVA_CONSOLE_API_KEY='osva_ak_…' pnpm --filter @osva/console start
```

Open **`http://127.0.0.1:4174`** (default `OSVA_CONSOLE_PORT`).

Details: [`CONSOLE.md`](CONSOLE.md).

### 8. Routine shutdown

From `deploy/compose`, stop containers **and keep volumes** (database and trusted-runtime data persist):

```bash
docker compose down
```

**Destructive reset** (deletes Compose volumes: PostgreSQL data, Valkey data, artifact and trusted-runtime volumes — all workspace state):

```bash
docker compose down -v
```

Only use `-v` when you intend to wipe local data and bootstrap again.

---

## Journey B — OSVA contributor

**Goal:** Run PostgreSQL and Valkey in Docker; run web, worker, and other apps from source for day-to-day development.

### 1. Prerequisites

- Node.js 24, pnpm 12.4.1 via Corepack (`corepack enable`)
- Docker Compose v2 (for root infrastructure only)
- Git

Local Compose credentials (`osva` / `osva` / `osva`) are not production-safe.

### 2. Configuration

From repository root:

```powershell
cd path\to\osva
corepack enable
pnpm install
Copy-Item .env.example .env   # reference only; not auto-loaded
```

Set **core** variables in **each** terminal that runs web, worker, scheduler, workflow-orchestrator, or knowledge-worker (use absolute paths as above). The same exports are required in the shell that runs **`pnpm db:migrate`**, **`pnpm db:bootstrap`**, and **`pnpm db:migrations:*`** (those CLIs read `OSVA_DATABASE_URL`, not `.env`).

- `OSVA_DATABASE_URL=postgres://osva:osva@127.0.0.1:5432/osva`
- `OSVA_VALKEY_URL=redis://127.0.0.1:6379`
- `OSVA_TRUSTED_RUNTIME_ROOT` (absolute)
- `OSVA_ARTIFACT_FILESYSTEM_ROOT` (absolute)
- `OSVA_WEB_HOST` / `OSVA_WEB_PORT` (default `127.0.0.1:3000`)
- **Knowledge indexing (required for `apps/web` startup):** `OSVA_KNOWLEDGE_EMBEDDING_PROVIDER=DETERMINISTIC`, `OSVA_KNOWLEDGE_EMBEDDING_MODEL=deterministic-v1`, `OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS=384` (same defaults as [`deploy/compose/compose.yml`](../../deploy/compose/compose.yml))

Optional worker-only: `OPENAI_API_KEY`, remote HTTP / container settings per [`.env.example`](../../.env.example).

Example PowerShell block (repository root):

```powershell
$RepoRoot = (Get-Location).Path
$env:OSVA_DATABASE_URL = "postgres://osva:osva@127.0.0.1:5432/osva"
$env:OSVA_VALKEY_URL = "redis://127.0.0.1:6379"
$env:OSVA_TRUSTED_RUNTIME_ROOT = Join-Path $RepoRoot "trusted-runtime"
$env:OSVA_ARTIFACT_FILESYSTEM_ROOT = Join-Path $RepoRoot ".osva\artifacts"
$env:OSVA_ARTIFACT_STORAGE_DRIVER = "filesystem"
$env:OSVA_WEB_HOST = "127.0.0.1"
$env:OSVA_WEB_PORT = "3000"
$env:OSVA_KNOWLEDGE_EMBEDDING_PROVIDER = "DETERMINISTIC"
$env:OSVA_KNOWLEDGE_EMBEDDING_MODEL = "deterministic-v1"
$env:OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS = "384"
```

### 3. Infrastructure

From repository root:

```bash
pnpm infra:up
```

Uses root [`docker-compose.yml`](../../docker-compose.yml) (PostgreSQL 17 + Valkey 8.1.10 on `127.0.0.1:5432` and `6379`).

Routine shutdown (**preserves volumes**):

```bash
pnpm infra:down
# equivalent: docker compose down   (from repository root)
```

**Destructive reset** (wipes local DB/Valkey volumes):

```bash
docker compose down -v
```

Run from repository root so the same compose file is used.

### 4. Migrations

```bash
pnpm db:migrate
```

Applications do not auto-migrate on startup. Do not use `drizzle-kit push` as the normal workflow.

If `pnpm db:migrate` fails because objects from a pending migration already exist, run `pnpm db:migrations:integrity` (with `OSVA_DATABASE_URL` set). **`schema_ahead`** means the physical schema and Drizzle journal disagree; follow the printed diagnostics (explicit reviewed repair). Do not use `docker compose down -v` on contributor infra unless you intend to wipe local database volumes.

### 5. Build

Initial and dependency-wide compile:

```bash
pnpm build
```

### 6. Start applications

Use **one terminal per process**, with the same core env vars exported in each.

```bash
pnpm dev:web
pnpm dev:worker
pnpm dev:scheduler
pnpm dev:workflow-orchestrator
```

Optional: `pnpm dev:knowledge-worker`, `pnpm dev:mcp-server`, `pnpm dev:console`.

Control plane URL on the host: **`http://127.0.0.1:3000`** (unless you changed `OSVA_WEB_PORT`).

#### TypeScript edits and `dev` watchers

`pnpm dev:web` and `pnpm dev:worker` run `node --watch dist/main.js`. They **reload when `dist/` changes**; they do **not** compile TypeScript.

After editing source in an app or its workspace dependencies, rebuild that app (and upstream packages as needed), for example:

```bash
pnpm --filter @osva/web build
pnpm --filter @osva/worker build
```

For shared package changes, use a scoped Turbo build (faster than full monorepo when possible):

```bash
pnpm exec turbo run build --filter=@osva/worker...
```

The `--watch` process picks up the new `dist/` output automatically.

### 7. Bootstrap

With web able to reach the database (migrations applied):

```bash
pnpm db:bootstrap
```

Copy **`Workspace ID:`** and the API key from stdout.

### 8. Doctor and first agent

```bash
pnpm verify:doctor
pnpm --filter @osva-ai/cli build
$env:OSVA_BASE_URL = "http://127.0.0.1:3000"
$env:OSVA_API_KEY = "osva_ak_…"
node packages/cli/dist/bin/osva.js doctor
```

Hello agent (host trusted runtime):

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:3000"
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_WORKSPACE_ID = "<Workspace ID from bootstrap>"
$env:OSVA_TRUSTED_RUNTIME_ROOT = "<same absolute path as worker>"
$env:OSVA_HELLO_TRUSTED_RUNTIME_MODE = "host"
pnpm example:hello
```

### 9. Product Console

| Variable | Contributor host stack |
| --- | --- |
| `OSVA_BASE_URL` | `http://127.0.0.1:3000` |
| `OSVA_CONSOLE_API_KEY` | Bootstrap API key |

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:3000"
$env:OSVA_CONSOLE_API_KEY = "osva_ak_…"
pnpm dev:console
```

Browser: **`http://127.0.0.1:5173`** (dev) or **`http://127.0.0.1:4174`** after `pnpm --filter @osva/console build` + `start`.

Inspect the hello Run under **Runs** or continue **First-agent onboarding** at `/onboarding`.

---

## Quality commands (contributors)

- `pnpm verify:doctor` — toolchain diagnostics
- `pnpm verify:quick` — inner loop (see [`DEVELOPMENT_GATES.md`](DEVELOPMENT_GATES.md))
- Do not substitute `verify:ci:clean` for routine doc edits

Integration tests may start their own Docker PostgreSQL; see root `README.md`.
