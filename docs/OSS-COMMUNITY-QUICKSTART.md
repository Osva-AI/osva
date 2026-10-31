# OSVA Community quickstart (current release candidate)

Authoritative path for a **self-hosted OSVA Community Edition** deployment using Docker Compose, authenticated `/v1`, TypeScript and Python SDKs, optional MCP, and the loopback Product Console.

> **Current release candidate:** **`1.1.0-rc.2`** (**not GA**). **`1.1.0-rc.2`** is **published** on npm (dist-tag **`rc`**), PyPI, GHCR, and GitHub Releases (tag **`v1.1.0-rc.2`**). **`v1.0.0`** remains the default stable release line on npm/PyPI **`latest`**. Published **`1.1.0-rc.1`** registry artifacts remain available for early adopters who already pinned them; **`@osva-ai/cli@1.1.0-rc.1` does not include M10.2 agent commands** (`init`, `validate`, `deploy`, `run`, `status`, `doctor`, templates). Use **`1.1.0-rc.2`** from registries or build from this repository for unreleased commits. Registry acceptance summary: [`release/M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](release/M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md).
>
> **Upgrading from published `v1.0.0`?** Apply migration **`0023_execution_lease_slice`** and review [`operations/UPGRADE.md`](operations/UPGRADE.md) before rolling workers.
>
> **Historical OSS 1.0 guide:** [`OSS-1.0-QUICKSTART.md`](OSS-1.0-QUICKSTART.md) (documents the **`v1.0.0`** tag baseline).

## M16 one-command install (platform 1.1.1+, after publication)

External install without cloning this repository (requires published npm **`@osva-ai/cli@1.1.2`** and GHCR **`ghcr.io/osva-ai/osva:1.1.1`**):

```powershell
npm install -g @osva-ai/cli@1.1.2
osva setup --yes
```

Follow Console onboarding at the printed loopback URL. Registry-verified acceptance: [`release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md`](release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md).

Until that release publishes, build the CLI from this repository or use **`deploy/compose`** below.

## Which local journey?

| Journey | Use this guide | Also read |
| --- | --- | --- |
| **External agent developer** — run OSVA in Docker, build agents on the host | Sections below (`deploy/compose`) | [`../packages/cli/README.md`](../packages/cli/README.md) |
| **OSVA contributor** — change OSVA source; infra in Docker, apps on the host | [`engineering/LOCAL_DEVELOPMENT.md`](engineering/LOCAL_DEVELOPMENT.md) (journey B) | Root [`README.md`](../README.md) |

Compose `.env` is loaded by Docker Compose only. Host CLI, examples, and Console still need **`OSVA_BASE_URL`**, **`OSVA_API_KEY`**, and related variables exported in each shell ([`engineering/LOCAL_DEVELOPMENT.md`](engineering/LOCAL_DEVELOPMENT.md)).

If you also develop against host Postgres/Valkey, keep **`OSVA_VALKEY_URL=redis://valkey:6379`** in `deploy/compose/.env` **and** unset host exports before `docker compose up` — shell variables override `--env-file` during Compose interpolation. Verification status: [`engineering/M10_3_SETUP_VERIFICATION.md`](engineering/M10_3_SETUP_VERIFICATION.md).

## Prerequisites

- Docker with Compose v2
- Node.js 24 + pnpm 12 (for SDK/CLI examples on your workstation)
- Python 3.11+ (for Python SDK examples)

## 1. Start OSVA (Compose)

**Pre-built GHCR image** (**`1.1.0-rc.2`** on GHCR):

```bash
cd deploy/compose
cp .env.example .env
# Set POSTGRES_PASSWORD in .env
# OSVA_IMAGE=ghcr.io/osva-ai/osva:1.1.0-rc.2
docker compose pull
docker compose up -d --wait
```

Do **not** pass **`--build`** when using a registry image — that triggers a local Dockerfile build (`osva:local`) instead of the published tag.

**Build from source** (contributors or unreleased commits):

```bash
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

Copy the printed `osva_ak_…` token immediately. It is shown once. Note the printed **`Workspace ID:`** for examples that require `OSVA_WORKSPACE_ID`.

Optional readiness check with the CLI (`OSVA_WORKSPACE_ID` not required):

```bash
export OSVA_BASE_URL=http://127.0.0.1:8080
export OSVA_API_KEY='osva_ak_…'
osva doctor   # npm install -g @osva-ai/cli@1.1.0-rc.2, or build from this repo
```

## 4. Run the Hello Agent (first execution)

Deterministic golden path — no paid model provider, no external calls during execution. From the repository clone on your **host** (not inside a container):

**Compose worker** (trusted runtime copied into the `osva-trusted-runtime` volume):

```powershell
# PowerShell (host)
$env:OSVA_BASE_URL = "http://127.0.0.1:8080"
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_WORKSPACE_ID = "<Workspace ID from bootstrap>"
$env:OSVA_HELLO_TRUSTED_RUNTIME_MODE = "compose"
pnpm install
pnpm example:hello
```

**Local dev worker** (`pnpm dev:web` + `pnpm dev:worker` on the host) — see journey B in [`engineering/LOCAL_DEVELOPMENT.md`](engineering/LOCAL_DEVELOPMENT.md):

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:3000"
$env:OSVA_API_KEY = "osva_ak_…"
$env:OSVA_WORKSPACE_ID = "<Workspace ID from bootstrap>"
$RepoRoot = (Get-Location).Path
$env:OSVA_TRUSTED_RUNTIME_ROOT = Join-Path $RepoRoot "trusted-runtime"
$env:OSVA_HELLO_TRUSTED_RUNTIME_MODE = "host"
pnpm example:hello
```

Expect terminal Run status **`SUCCEEDED`** and output `{ "echoed": "Hello OSVA" }`. Details: [`../examples/hello-agent/README.md`](../examples/hello-agent/README.md).

## 4b. Standalone agent with `@osva-ai/cli` (M10.2)

From any directory — install **`@osva-ai/cli@1.1.0-rc.2`** from npm, or build from this repository (**not** `@1.1.0-rc.1`):

```powershell
npm install -g @osva-ai/cli@1.1.0-rc.2
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

Install the matching RC from npm: `npm install @osva-ai/sdk@1.1.0-rc.2` (dist-tag **`rc`**), or build from this repository.

## 7. Python SDK

```bash
python -m pip install osva-sdk==1.1.0rc2   # or pip install ./sdks/python from a clone
export OSVA_BASE_URL=http://127.0.0.1:8080
export OSVA_API_KEY='osva_ak_…'
python -c "
import os
from osva import OSVAClient
client = OSVAClient(base_url=os.environ['OSVA_BASE_URL'], api_key=os.environ['OSVA_API_KEY'])
print(client.agents.list())
"
```

PyPI prerelease versions use PEP 440 form (**`1.1.0rc2`**, not `1.1.0-rc.2`).

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

Routine shutdown from `deploy/compose` (**keeps** PostgreSQL, Valkey, artifact, and trusted-runtime volumes):

```bash
docker compose down
```

**Destructive reset** — deletes all Compose volumes and workspace data; bootstrap again afterward:

```bash
docker compose down -v
```

## 10. Product Console (optional)

Console is not started by Compose. Default mode uses **human sessions** (no Console API key). Ensure `apps/web` has **`OSVA_AUTH_SECRET`** (same as Compose `.env`) and trusted origins include the Console URL.

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:8080"
$env:OSVA_AUTH_SECRET = "<same-as-web>"
pnpm identity:bootstrap   # once: save setup token from stdout
pnpm dev:console
```

Open **`http://127.0.0.1:5173`**, complete **`/setup`** with the bootstrap token, then sign in. After `pnpm --filter @osva/console build` and `start`, open **`http://127.0.0.1:4174`**.

Legacy API-key BFF (deprecated): `OSVA_CONSOLE_LEGACY_API_KEY_MODE=true` and `OSVA_CONSOLE_API_KEY`. See [`engineering/CONSOLE.md`](engineering/CONSOLE.md).

## Community boundaries

- **Machine access:** API keys and API-key RBAC (CLI, SDK, MCP).
- **Human access:** local password sessions and fixed workspace roles (M11); **OIDC** is future Community work; **SAML/SCIM** are Teams/Enterprise.
- Console loopback trust boundary; not a substitute for ingress auth on the public internet.
- No guaranteed HA or exactly-once external side effects.
- S3-compatible artifact storage is supported by configuration; independent S3 disaster-recovery restore is **not** M9.7 acceptance-tested.
- Observability (OpenTelemetry) is opt-in via environment.

## Next steps

- CLI agent workflow: [`../packages/cli/README.md`](../packages/cli/README.md)
- Hello Agent golden path: [`../examples/hello-agent/README.md`](../examples/hello-agent/README.md)
- Local development journeys: [`engineering/LOCAL_DEVELOPMENT.md`](engineering/LOCAL_DEVELOPMENT.md)
- Product Console: [`engineering/CONSOLE.md`](engineering/CONSOLE.md)
- Canonical M7 demo (completed): [`../examples/canonical-dependency-adoption/README.md`](../examples/canonical-dependency-adoption/README.md)
- [`architecture/DEPLOYMENT_TOPOLOGIES.md`](architecture/DEPLOYMENT_TOPOLOGIES.md)
- [`deployment/CONFIGURATION.md`](deployment/CONFIGURATION.md)
- [`operations/RUNBOOK.md`](operations/RUNBOOK.md)
- [`operations/UPGRADE.md`](operations/UPGRADE.md)
- [`release/COMPATIBILITY.md`](release/COMPATIBILITY.md)
