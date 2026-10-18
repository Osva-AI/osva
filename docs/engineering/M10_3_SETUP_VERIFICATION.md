# M10.3 local setup verification (status)

Snapshot of what was exercised on a Windows developer machine during M10.3A–M10.3D. This is **not** a substitute for `pnpm verify:ci:clean` or release acceptance.

> **Superseded for Console auth (M11):** Default Console no longer requires `OSVA_CONSOLE_API_KEY`. Use human bootstrap and [`CONSOLE.md`](CONSOLE.md). Rows below describe pre-M11 verification only.

## What is verified

| Area | Evidence | Notes |
| --- | --- | --- |
| **Documentation (M10.3A)** | Prettier, docs link check, hello-agent onboarding test | Two journeys documented in [`LOCAL_DEVELOPMENT.md`](LOCAL_DEVELOPMENT.md) |
| **Isolated Compose + source CLI (M10.3C)** | Compose project **`osva-m103c`**, temp env under `%TEMP%\osva-m103c-isolated\`, web port **8083** | Fresh DB bootstrap, migrations **current**, integrity **applied_and_matches** |
| **CLI golden path** | init → validate → deploy ×2 (reuse) → run ×2 **`SUCCEEDED`**, greeting **`Hello, Hello OSVA!`** | CLI/SDK **built from this repository** (`@osva-ai/cli` reports **`1.1.0-rc.1`** version string) |
| **Persistence** | `docker compose down` (no `-v`) → `up --wait` → same API key auth, agent readable, third run **SUCCEEDED** | Volumes retained as **`osva-m103c_osva-*`** |
| **Compose env precedence (M10.3C/D)** | Host **`OSVA_VALKEY_URL`** overrode `--env-file` until unset; containers recovered after **`redis://valkey:6379`** in temp env | See [`../../deploy/compose/.env.example`](../../deploy/compose/.env.example) |

## What is not verified (limitations)

| Area | Status |
| --- | --- |
| **Published npm/PyPI/GHCR `1.1.0-rc.1` artifacts** | **Not tested** — CLI/SDK were source builds; server was cached **`osva:local`** (`sha256:b30e6e0b…`, image created **2026-10-15**), not rebuilt against current `main` during M10.3C |
| **Journey B (contributor host web/worker)** | **Not fully verified** — `/ready` **200** after knowledge env documented (M10.3B); **authenticated** Hello Agent and Console **not** run (existing root Postgres has **`schema_ahead`** journal drift; bootstrap plaintext key **not** available in later sessions) |
| **Console browser inspection (M10.3D)** | **Blocked on credentials** — bootstrap API key exists in isolated DB (hashed) but **plaintext not stored** after M10.3C; OSVA does not recover keys from PostgreSQL. Console **requires** `OSVA_CONSOLE_API_KEY` in the server process |
| **Console authenticated BFF / UI** | **Not verified** in M10.3D without bootstrap plaintext |

### M10.3D Console infrastructure smoke (not authenticated UI)

With isolated stack **`/ready` 200** on port **8083**, bootstrap plaintext **unavailable**, and a **non-bootstrap** placeholder in `OSVA_CONSOLE_API_KEY` (listen test only):

| Check | Result |
| --- | --- |
| `pnpm dev:console` from repo root | **PASS** — compiles server, BFF log: `listening on http://127.0.0.1:4175`, Vite **ready** on port **5174** (`OSVA_CONSOLE_VITE_PORT` / `OSVA_CONSOLE_PORT`) |
| BFF `GET /api/v1/auth/context` | **HTTP 401** (expected with placeholder key; proves listener only) |
| Vite `GET /` | **HTTP 200** at `http://localhost:5174/` (use `localhost` if `127.0.0.1` fails on your host) |
| Browser agent/run inspection | **Not performed** — requires real bootstrap `OSVA_CONSOLE_API_KEY` |

**Why M10.3C Console failed:** `node apps/console/scripts/dev.mjs` was invoked **without** prior `tsc` (`dist/server/main.js` missing) and without `OSVA_CONSOLE_API_KEY`; default ports **5173** / **4174** were also occupied on that host.

## Recorded isolated-run IDs (non-secret)

From `%TEMP%\osva-m103c-isolated\session-meta.json` (M10.3C):

- Workspace: `e268a4f5-d34b-4047-9b60-4b2aaf593f58`
- Agent: `86dc9329-f158-460a-9e85-d0f203fdb2f7`
- AgentVersion: `ff93e0b8-0071-4419-ac71-c25eb8c1dd5c`
- Runs: `6a01e8a3-f1cc-43a3-b4bb-e61ad2917556`, `e9a85ea4-27fc-4c32-af5b-18e5ed1464ed`, `9ee078d4-4d08-443c-a6cc-44d5196a19aa` (after restart)

## Console handoff (isolated Compose)

Prerequisites:

1. Isolated stack running (`docker compose -p osva-m103c … up -d --wait`), **`GET http://127.0.0.1:8083/ready` → 200**
2. **`OSVA_CONSOLE_API_KEY`** = bootstrap `osva_ak_…` (you must still have the one-time bootstrap output; **not** recoverable from the DB)
3. Free ports or overrides: default Vite **`5173`**, BFF **`4174`** (`strictPort` — choose alternates if occupied)

From repository root (compiles console server, then `scripts/dev.mjs`):

```powershell
Remove-Item Env:OSVA_VALKEY_URL,Env:OSVA_DATABASE_URL -ErrorAction SilentlyContinue
$env:OSVA_BASE_URL = "http://127.0.0.1:8083"
$env:OSVA_CONSOLE_API_KEY = "osva_ak_…"   # from bootstrap; server-side only
# Optional when defaults are in use:
# $env:OSVA_CONSOLE_PORT = "4175"
# $env:OSVA_CONSOLE_VITE_PORT = "5174"
pnpm dev:console
```

- Browser UI: `http://127.0.0.1:5173` (or your `OSVA_CONSOLE_VITE_PORT`)
- Vite proxies `/api` → BFF at `http://127.0.0.1:4174` (or your `OSVA_CONSOLE_PORT`)

Do **not** run `node apps/console/scripts/dev.mjs` alone — it expects **`apps/console/dist/server/main.js`** from `tsc` (see `pnpm dev:console` in `apps/console/package.json`).

Manual UI checks (after you have the key):

- **Agents** → agent `86dc9329-f158-460a-9e85-d0f203fdb2f7`
- **Runs** → run `6a01e8a3-f1cc-43a3-b4bb-e61ad2917556` (terminal **SUCCEEDED**)

Full Console reference: [`CONSOLE.md`](CONSOLE.md).

## Credential availability (M10.3D)

The M10.3C bootstrap plaintext key was held only in that session’s process environment and was **not** written to `session-meta.json`. After the shell ends, **assume the key is unavailable** unless you saved bootstrap output yourself. Creating a new key would require a deliberate operator action (not performed during M10.3).
