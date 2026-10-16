# Hello Agent (OSVA golden path)

Deterministic first agent for OSVA Community Edition. No paid model provider and no outbound network calls during execution.

## Contract

Input:

```json
{ "message": "Hello OSVA" }
```

Output:

```json
{ "echoed": "Hello OSVA" }
```

Runtime: **TRUSTED_TYPESCRIPT** with real `sha256:` integrity enforcement.

## Prerequisites

- Running OSVA control plane and **worker** (Compose or local `pnpm dev:*`)
- Bootstrap API key (`osva_ak_…`)
- Node.js 24 + pnpm (from repository root)

## Golden path (one command)

From the repository root after `pnpm install` and `pnpm build`:

### Local dev worker (`pnpm dev:web` + `pnpm dev:worker`)

PowerShell:

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:3000"
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_WORKSPACE_ID = "<Workspace ID from bootstrap>"
$RepoRoot = (Get-Location).Path
$env:OSVA_TRUSTED_RUNTIME_ROOT = Join-Path $RepoRoot "trusted-runtime"
$env:OSVA_HELLO_TRUSTED_RUNTIME_MODE = "host"
pnpm example:hello
```

bash (run from repository root; use the same absolute trusted-runtime path the worker uses):

```bash
export OSVA_BASE_URL=http://127.0.0.1:3000
export OSVA_API_KEY='osva_ak_…'
export OSVA_WORKSPACE_ID='<Workspace ID from bootstrap>'
export OSVA_TRUSTED_RUNTIME_ROOT="$(pwd)/trusted-runtime"
export OSVA_HELLO_TRUSTED_RUNTIME_MODE=host
pnpm example:hello
```

Contributor setup: [`../../docs/engineering/LOCAL_DEVELOPMENT.md`](../../docs/engineering/LOCAL_DEVELOPMENT.md).

### Docker Compose worker (`deploy/compose`)

Start Compose, bootstrap, then run from the host (copies the agent into the `osva-trusted-runtime` volume the worker mounts):

PowerShell:

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:8080"
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_WORKSPACE_ID = "<Workspace ID from bootstrap>"
$env:OSVA_HELLO_TRUSTED_RUNTIME_MODE = "compose"
# Optional if you started Compose with a custom project name:
# $env:OSVA_COMPOSE_PROJECT = "my-project"
# or standard Docker Compose: $env:COMPOSE_PROJECT_NAME = "my-project"
pnpm example:hello
```

Compose mode resolves the worker trusted-runtime volume via Docker Compose labels (`com.docker.compose.project` + `com.docker.compose.volume=osva-trusted-runtime`), not a guessed volume name. After copy, the tool re-reads the installed entrypoint from the volume and verifies its digest matches the compiled `dist/agent/hello-agent.js` executable.

The script exits non-zero when `/ready` fails, the Compose volume is missing, install verification fails, or the Run does not reach terminal `SUCCEEDED` with matching output within the poll timeout.

## Inspect a Run

```bash
pnpm --filter @osva/example-hello-agent run status -- <runId>
```

## Modify the agent

Edit `agent/hello-agent.ts`, then re-run `pnpm example:hello`. A new immutable AgentVersion is created when integrity changes; compatible versions are reused safely.

## Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `/ready` errors | PostgreSQL or Valkey not reachable |
| Run stays `QUEUED` / timeout | Worker not running or trusted runtime path mismatch |
| Integrity failure | Entrypoint bytes changed without redeploying to worker root/volume |
| `401` / `403` | Missing or insufficient API key role (needs execute) |

## Tests

```bash
pnpm --filter @osva/example-hello-agent test
pnpm --filter @osva/example-hello-agent test:integration
```

Integration tests provision ephemeral PostgreSQL and Valkey via Docker (same harness as `@osva/worker` integration tests).
