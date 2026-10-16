# OSVA Community quickstart (current release candidate)

Authoritative path for a **self-hosted OSVA Community Edition** deployment using Docker Compose, authenticated `/v1`, TypeScript and Python SDKs, optional MCP, and the loopback Product Console.

> **Current in-tree version:** **`1.1.0-rc.1`** (release candidate — **not GA**). **`1.1.0-rc.1`** npm/PyPI/GHCR artifacts are published for early adopters; **`v1.0.0`** remains the default stable release line. Align tags with root `VERSION` at the commit you deploy.
>
> **Upgrading from published `v1.0.0`?** Apply migration **`0023_execution_lease_slice`** and review [`operations/UPGRADE.md`](operations/UPGRADE.md) before rolling workers.
>
> **Historical OSS 1.0 guide:** [`OSS-1.0-QUICKSTART.md`](OSS-1.0-QUICKSTART.md) (documents the **`v1.0.0`** tag baseline).

## Prerequisites

- Docker with Compose v2
- Node.js 24 + pnpm 12 (for SDK/CLI examples on your workstation)
- Python 3.11+ (for Python SDK examples)

## 1. Start OSVA (Compose)

```bash
cd deploy/compose
cp .env.example .env
# Set POSTGRES_PASSWORD in .env
# Optional: OSVA_IMAGE=osva:1.1.0-rc.1 when using a pre-built image
docker compose up -d --build --wait
```

Compose bundles **PostgreSQL (pgvector)** and **Valkey** for convenience, shares a filesystem artifact volume across app containers, and keeps **`OSVA_CONTAINER_ENABLED=false`** by default. The Product Console is **not** started by default Compose; run `pnpm dev:console` locally against the API when needed (loopback bind).

## 2. Migrate

`docker compose up` already runs the `migrate` service (other app services `depends_on` it). Applications do not auto-migrate at process start. To run migrations alone:

```bash
docker compose run --rm migrate
```

After upgrading from **`v1.0.0`**, confirm migration **`0023_execution_lease_slice`** applied (`pnpm db:migrations:status` / `pnpm db:migrations:integrity` against your database URL).

## 3. Bootstrap (initial API key)

Bootstrap is a deliberate operator action:

```bash
docker compose --profile bootstrap run --rm bootstrap
```

Copy the printed `osva_ak_…` token immediately. It is shown once.

## 4. Run the Hello Agent (first execution)

Deterministic golden path — no paid model provider, no external calls during execution. From the repository clone on your **host** (not inside a container):

**Compose worker** (trusted runtime copied into the `osva-trusted-runtime` volume):

```powershell
# PowerShell (host)
$env:OSVA_BASE_URL = "http://127.0.0.1:8080"
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_WORKSPACE_ID = "ws-…"   # from bootstrap output
$env:OSVA_HELLO_TRUSTED_RUNTIME_MODE = "compose"
pnpm install
pnpm example:hello
```

**Local dev worker** (`pnpm dev:web` + `pnpm dev:worker` on the host):

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:3000"
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_WORKSPACE_ID = "ws-dev"
$env:OSVA_TRUSTED_RUNTIME_ROOT = "$PWD\trusted-runtime"
$env:OSVA_HELLO_TRUSTED_RUNTIME_MODE = "host"
pnpm example:hello
```

Expect terminal Run status **`SUCCEEDED`** and output `{ "echoed": "Hello OSVA" }`. Details: [`../examples/hello-agent/README.md`](../examples/hello-agent/README.md).

## 4b. Standalone agent with `@osva-ai/cli` (M10.2)

From any directory (install CLI from npm or build from this repository):

```powershell
npm install -g @osva-ai/cli@1.1.0-rc.1
osva init my-first-agent
cd my-first-agent
npm install
npm run build
npm run manifest
osva validate

$env:OSVA_BASE_URL = "http://127.0.0.1:8080"   # or your publish port (e.g. 8082)
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_TRUSTED_RUNTIME_MODE = "compose"
$env:OSVA_COMPOSE_DIR = "C:\path\to\osva\deploy\compose"

osva deploy
osva run --wait --input-file run-input.json   # recommended on PowerShell
```

Create `run-input.json` as UTF-8: `{ "message": "Hello OSVA" }`. Expect output `{ "greeting": "Hello, Hello OSVA!" }`. Repeat `osva deploy` to confirm AgentVersion reuse; repeat `osva run` to create new Runs.

Full CLI reference: [`../packages/cli/README.md`](../packages/cli/README.md). Offline packaged CLI check: `pnpm acceptance:m10-2e:pack`. Live opt-in workflow: `OSVA_ACCEPTANCE_LIVE=1 pnpm acceptance:m10-2e`.

## 5. Call authenticated `/v1`

```bash
export OSVA_API_KEY='osva_ak_…'   # from bootstrap output
curl -sS -H "Authorization: Bearer $OSVA_API_KEY" \
  http://127.0.0.1:8080/v1/api-keys | jq .
```

(Adjust host/port if you changed `OSVA_PUBLISH_WEB_PORT` in `.env`.)

## 6. TypeScript SDK

```bash
cd /path/to/osva
pnpm install
pnpm exec turbo run build --filter=@osva-ai/sdk
export OSVA_BASE_URL=http://127.0.0.1:8080
export OSVA_API_KEY='osva_ak_…'
node --input-type=module -e "
  import { OsvaClient } from '@osva-ai/sdk';
  const client = new OsvaClient({ baseUrl: process.env.OSVA_BASE_URL, apiKey: process.env.OSVA_API_KEY });
  const keys = await client.apiKeys.list();
  console.log(keys);
"
```

Install the matching RC from npm: `npm install @osva-ai/sdk@1.1.0-rc.1` (dist-tag `rc` may apply), or build from this repository.

## 7. Python SDK

```bash
python -m pip install ./sdks/python   # or pip install osva-sdk==1.1.0-rc.1 when on PyPI
export OSVA_BASE_URL=http://127.0.0.1:8080
export OSVA_API_KEY='osva_ak_…'
python -c "
import os
from osva import OSVAClient
client = OSVAClient(base_url=os.environ['OSVA_BASE_URL'], api_key=os.environ['OSVA_API_KEY'])
print(client.agents.list())
"
```

## 8. Optional MCP

The Compose stack starts `mcp-server` on the published MCP port (default **3100**, override with `OSVA_PUBLISH_MCP_PORT`).

- `GET /health` — not subject to MCP Host header validation.
- MCP routes validate `Host` via `OSVA_MCP_ALLOWED_HOSTS`.

Example health check:

```bash
curl -sS http://127.0.0.1:3100/health
```

Configure MCP clients to use an allowed Host (for example `127.0.0.1`) and the MCP URL documented in [`deployment/CONFIGURATION.md`](deployment/CONFIGURATION.md).

## 9. Stop / cleanup

```bash
docker compose down -v
```

## Community boundaries

- API-key identity and RBAC only; no Enterprise SSO/SCIM.
- Console loopback trust boundary; not a substitute for ingress auth on the public internet.
- No guaranteed HA or exactly-once external side effects.
- S3-compatible artifact storage is supported by configuration; independent S3 disaster-recovery restore is **not** M9.7 acceptance-tested.
- Observability (OpenTelemetry) is opt-in via environment.

## Next steps

- CLI agent workflow: [`../packages/cli/README.md`](../packages/cli/README.md)
- Hello Agent golden path: [`../examples/hello-agent/README.md`](../examples/hello-agent/README.md)
- Product Console: [`engineering/CONSOLE.md`](engineering/CONSOLE.md)
- Canonical M7 demo (completed): [`../examples/canonical-dependency-adoption/README.md`](../examples/canonical-dependency-adoption/README.md)
- [`architecture/DEPLOYMENT_TOPOLOGIES.md`](architecture/DEPLOYMENT_TOPOLOGIES.md)
- [`deployment/CONFIGURATION.md`](deployment/CONFIGURATION.md)
- [`operations/RUNBOOK.md`](operations/RUNBOOK.md)
- [`operations/UPGRADE.md`](operations/UPGRADE.md)
- [`release/COMPATIBILITY.md`](release/COMPATIBILITY.md)
