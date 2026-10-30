# @osva-ai/cli

Official OSVA command-line interface for local agent development and control-plane operations.

**Node.js:** >= 24 (matches `engines` in this package).

## Installation

From npm:

```bash
npm install -g @osva-ai/cli@1.1.0-rc.2
```

Or use `npx`:

```bash
npx @osva-ai/cli@1.1.0-rc.2 help
```

**Do not use `@1.1.0-rc.1` for M10.2 agent commands** — that npm tarball predates `init`, `validate`, `deploy`, `run`, `status`, and `doctor`.

From a git checkout, build then invoke `dist/bin/osva.js` or link the package locally.

`@osva-ai/cli` depends on `@osva-ai/sdk`, `@osva-ai/contracts`, and `ajv`; npm installs them automatically when published with aligned dependency versions.

## Self-hosted installation (`osva setup`)

Materializes a local Compose project (registry-pinned `OSVA_IMAGE` in the bundled template), starts PostgreSQL/Valkey, migrates on first install, starts platform services and Console, and bootstraps the initial workspace plus human administrator when needed.

```bash
osva setup --admin-email you@example.com
```

Use `--yes` to reconcile an existing installation directory. Console is published on loopback (default `http://127.0.0.1:4174`). Complete password setup at `/setup`, then sign in.

**Published image note:** GHCR tags shipped before M16.2 Console packaging require a matching OCI rebuild; development acceptance builds a local image (`osva/local-m16-2d:dev`). Test-only overrides: `OSVA_SETUP_LOCAL_IMAGE`, `OSVA_SETUP_SKIP_IMAGE_PULL`, and acceptance capture flags documented in [`scripts/acceptance/m16-2d/README.md`](../../scripts/acceptance/m16-2d/README.md).

## Quick start (standalone agent project)

```bash
mkdir my-agents && cd my-agents
osva init my-first-agent
cd my-first-agent
npm install
npm run build
npm run manifest
osva validate
```

Configure the control plane and trusted runtime (see below), then:

```bash
osva deploy
osva run --wait --input '{"message":"Hello OSVA"}'
osva status
```

Generated projects use output field **`greeting`** (for example `"Hello, Hello OSVA!"`).

## Configuration

| Variable | Required for | Description |
|----------|----------------|-------------|
| `OSVA_BASE_URL` | deploy, run, status, API commands | Control plane URL (e.g. `http://127.0.0.1:8080`) |
| `OSVA_API_KEY` | deploy, run, status, API commands | Bearer token (`osva_ak_…`); **never** pass `--api-key` (unsupported) |
| `OSVA_WORKSPACE_ID` | optional | If set, must match the workspace for `OSVA_API_KEY` |
| `OSVA_TRUSTED_RUNTIME_MODE` | deploy | `host` or `compose` (default: `host` if `OSVA_TRUSTED_RUNTIME_ROOT` is set, else `compose`) |
| `OSVA_TRUSTED_RUNTIME_ROOT` | deploy (host) | Directory the worker reads for TRUSTED_TYPESCRIPT entrypoints |
| `OSVA_COMPOSE_DIR` | deploy (compose) | Path to `deploy/compose` (directory containing `compose.yml`) |
| `OSVA_COMPOSE_PROJECT` / `COMPOSE_PROJECT_NAME` | optional | Compose project name when not the default |
| `OSVA_RUN_POLL_INTERVAL_MS` / `OSVA_RUN_POLL_TIMEOUT_MS` | optional | `--wait` polling (defaults 500 ms / 120 s) |

Global flags: `--base-url`, `--json`, and `--project <dir>` (agent project root).

Precedence: CLI flag > environment variable.

## Trusted runtime: host vs Compose

**Host** — for local `pnpm dev:worker` with a shared directory:

```bash
export OSVA_TRUSTED_RUNTIME_MODE=host
export OSVA_TRUSTED_RUNTIME_ROOT=/path/to/trusted-runtime
```

**Compose** — copies the built entrypoint into the worker’s `osva-trusted-runtime` volume (discovered via Docker Compose labels, not a guessed volume name):

```bash
export OSVA_TRUSTED_RUNTIME_MODE=compose
export OSVA_COMPOSE_DIR=/path/to/osva/deploy/compose
```

Deploy installs **only** your agent’s manifest entrypoint file; it does not overwrite unrelated agents with different entrypoint paths.

## Commands

### Local (no API credentials)

- `osva init <project-name> [--yes] [--json]`
- `osva validate [--project DIR] [--json]`
- `osva doctor [--json]`
- `osva help` / `osva version`

### Agent workflow (API credentials required)

- `osva deploy [--project DIR] [--json]` — validate, install bytes, register AgentVersion, write `.osva/deployment.json`
- `osva run [--project DIR] --input '<json>' | --input-file <path> [--wait] [--json]`
- `osva status [--project DIR] [--json]`

### Control plane (API credentials required)

- `osva agents list` / `osva agents get <id>`
- `osva runs create --agent-id … --agent-version-id … [--input '{}']`
- `osva runs get <runId>`
- `osva workflows …`, `osva approvals …`, `osva schedules list`

See `osva help` for the full list.

## JSON input (PowerShell, Bash, CI)

Prefer **`--input-file`** when shells mangle quotes:

```powershell
@'
{"message":"Hello OSVA"}
'@ | Set-Content -Encoding utf8 run-input.json
osva run --wait --input-file run-input.json
```

Inline JSON (Bash):

```bash
osva run --wait --input '{"message":"Hello OSVA"}'
```

PowerShell inline (escape nested quotes):

```powershell
osva run --wait --input '{\"message\":\"Hello OSVA\"}'
```

## JSON output and exit codes

- With `--json`, structured results go to **stdout** as a single JSON document; diagnostics for local validation failures also use stdout for validate/deploy preflight.
- API/transport failures with `--json` emit `{ "error": { "kind": "api" | "transport", … } }` on stdout (no API key material).
- Exit code `0` on success; non-zero on validation failure, configuration errors, deploy/run failures, or `--wait` when the Run does not succeed.
- Human-readable errors go to **stderr** and are redacted for secret-like patterns.

## Manifest and integrity

1. `npm run build` — emits `dist/agent/<entrypoint>.js`
2. `npm run manifest` — writes `osva.manifest.json` with `runtime.integrity` (`sha256:…`) from the built file
3. `osva validate` / `osva deploy` — refuse stale or tampered artifacts when digest ≠ manifest

Changing source requires rebuild + manifest + deploy to produce a new immutable AgentVersion.

## Local state

Non-secret deployment metadata: `.osva/deployment.json` (gitignored in scaffolds). Contains agent/version IDs, integrity fingerprint, deploy target, and last run IDs — **not** API keys.

## Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `Missing OSVA_BASE_URL` / `OSVA_API_KEY` | Export credentials before deploy/run |
| `Compose deploy mode requires OSVA_COMPOSE_DIR` | Set compose directory or use host mode |
| `No trusted-runtime Compose volume found` | Start Compose worker stack; check project name env vars |
| Validate `artifact_integrity` FAIL | Run `npm run build` then `npm run manifest` |
| `Run osva deploy before osva run` | Deploy after manifest changes |
| Run timeout with `--wait` | Worker not running or trusted runtime path/volume mismatch |
| HTTP 401/403 | Invalid or under-privileged API key |

Run `osva doctor --json` to probe `/health`, `/ready`, and `/v1/auth/context`.

## Limitations

- TRUSTED_TYPESCRIPT agents only; host or Compose trusted-runtime targets only (no remote SSH/prod push).
- `osva run` without `--wait` submits a Run but does not wait for terminal execution.
- No built-in login or credential store; use environment variables or your shell profile.

## Links

- [Community quickstart](../../docs/OSS-COMMUNITY-QUICKSTART.md)
- [SDK documentation](../../docs/engineering/SDK.md)
- M10.2E acceptance: `pnpm acceptance:m10-2e:pack` (offline), `OSVA_ACCEPTANCE_LIVE=1 pnpm acceptance:m10-2e` (live)

## License

Apache-2.0
