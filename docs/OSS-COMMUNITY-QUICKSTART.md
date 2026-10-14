# OSVA Community quickstart (current release candidate)

Authoritative path for a **self-hosted OSVA Community Edition** deployment using Docker Compose, authenticated `/v1`, TypeScript and Python SDKs, optional MCP, and the loopback Product Console.

> **Current in-tree version:** **`1.1.0-rc.1`** (release candidate — not GA). Align npm, PyPI, container, and Helm tags with `VERSION` at the commit you deploy. Registry artifacts are **unpublished** until maintainers complete RC.3 verification.
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

## 4. Call authenticated `/v1`

```bash
export OSVA_API_KEY='osva_ak_…'   # from bootstrap output
curl -sS -H "Authorization: Bearer $OSVA_API_KEY" \
  http://127.0.0.1:8080/v1/api-keys | jq .
```

(Adjust host/port if you changed `OSVA_PUBLISH_WEB_PORT` in `.env`.)

## 5. TypeScript SDK

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

When published, install the matching RC: `npm install @osva-ai/sdk@1.1.0-rc.1` (dist-tag `rc` may apply).

## 6. Python SDK

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

## 7. Optional MCP

The Compose stack starts `mcp-server` on the published MCP port (default **3100**, override with `OSVA_PUBLISH_MCP_PORT`).

- `GET /health` — not subject to MCP Host header validation.
- MCP routes validate `Host` via `OSVA_MCP_ALLOWED_HOSTS`.

Example health check:

```bash
curl -sS http://127.0.0.1:3100/health
```

Configure MCP clients to use an allowed Host (for example `127.0.0.1`) and the MCP URL documented in [`deployment/CONFIGURATION.md`](deployment/CONFIGURATION.md).

## 8. Stop / cleanup

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

- Product Console: [`engineering/CONSOLE.md`](engineering/CONSOLE.md)
- Canonical demo: [`../examples/canonical-dependency-adoption/README.md`](../examples/canonical-dependency-adoption/README.md)
- [`architecture/DEPLOYMENT_TOPOLOGIES.md`](architecture/DEPLOYMENT_TOPOLOGIES.md)
- [`deployment/CONFIGURATION.md`](deployment/CONFIGURATION.md)
- [`operations/RUNBOOK.md`](operations/RUNBOOK.md)
- [`operations/UPGRADE.md`](operations/UPGRADE.md)
- [`release/COMPATIBILITY.md`](release/COMPATIBILITY.md)
