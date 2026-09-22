# OSVA OSS 1.0 quickstart

Authoritative path for a **self-hosted OSVA OSS 1.0** deployment using Docker Compose, authenticated `/v1`, TypeScript and Python SDKs, and optional MCP.

> **OSVA 1.0.0** source release. This quickstart matches the self-hosted Compose distribution in-tree. npm, PyPI, and container registry installs use the same versions once those artifacts are published.

## Prerequisites

- Docker with Compose v2
- Node.js 24 + pnpm 12 (for SDK/CLI examples on your workstation)
- Python 3.11+ (for Python SDK examples)

## 1. Start OSVA (Compose)

```bash
cd deploy/compose
cp .env.example .env
# Set POSTGRES_PASSWORD in .env
docker compose up -d --build --wait
```

Compose bundles **PostgreSQL (pgvector)** and **Valkey** for convenience, shares a filesystem artifact volume across app containers, and keeps **`OSVA_CONTAINER_ENABLED=false`** by default.

## 2. Migrate

Migrations are explicit (applications do not auto-migrate):

```bash
docker compose run --rm migrate
```

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
pnpm exec turbo run build --filter=@osva/sdk
export OSVA_BASE_URL=http://127.0.0.1:8080
export OSVA_API_KEY='osva_ak_…'
node --input-type=module -e "
  import { OsvaClient } from '@osva/sdk';
  const client = new OsvaClient({ baseUrl: process.env.OSVA_BASE_URL, apiKey: process.env.OSVA_API_KEY });
  const keys = await client.listApiKeys();
  console.log(keys);
"
```

Published npm install (`@osva/sdk@1.0.0`) follows the same client surface when the package is available on npm.

## 6. Python SDK

```bash
python -m pip install ./sdks/python   # or `pip install osva-sdk==1.0.0` when on PyPI
export OSVA_BASE_URL=http://127.0.0.1:8080
export OSVA_API_KEY='osva_ak_…'
python -c "
import os
from osva import OSVAClient
client = OSVAClient(base_url=os.environ['OSVA_BASE_URL'], api_key=os.environ['OSVA_API_KEY'])
print(client.list_api_keys())
"
```

## 7. Optional MCP

The Compose stack starts `mcp-server` on the published MCP port (default **13100**).

- `GET /health` — not subject to MCP Host header validation.
- MCP routes validate `Host` via `OSVA_MCP_ALLOWED_HOSTS`.

Example health check:

```bash
curl -sS http://127.0.0.1:13100/health
```

Configure MCP clients to use an allowed Host (for example `127.0.0.1`) and the MCP URL documented in [`deployment/CONFIGURATION.md`](deployment/CONFIGURATION.md).

## 8. Stop / cleanup

```bash
docker compose down -v
```

## Next steps

- [`architecture/DEPLOYMENT_TOPOLOGIES.md`](architecture/DEPLOYMENT_TOPOLOGIES.md)
- [`deployment/CONFIGURATION.md`](deployment/CONFIGURATION.md)
- [`operations/RUNBOOK.md`](operations/RUNBOOK.md)
- [`operations/UPGRADE.md`](operations/UPGRADE.md)
