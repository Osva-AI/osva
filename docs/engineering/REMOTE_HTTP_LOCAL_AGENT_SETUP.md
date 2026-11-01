# Host-based REMOTE_HTTP agents (local development)

Use this path when a **REMOTE_HTTP** agent runs on your workstation (or another host process) while OSVA runs in Docker via `osva setup` or `deploy/compose`.

Production installs keep private-network tool/runtime access **off** unless explicitly configured. Local development uses an **opt-in profile** that wires the runtime capability bridge and operator-only private-network exceptions.

## CLI installation (recommended)

Requires `@osva-ai/cli` with bundled Compose templates (M17.8+).

```powershell
npm install -g @osva-ai/cli@latest
osva setup --remote-http-dev --admin-email you@example.com
```

This:

- Generates `OSVA_RUNTIME_CAPABILITY_SECRET` in the installation `.env` (installation-specific, never logged by the CLI).
- Publishes the worker capability listener on **loopback only** (default port **8787**).
- Sets `OSVA_RUNTIME_CAPABILITY_BASE_URL=http://127.0.0.1:8787` for capability credentials issued to host runtimes.
- Enables `OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS` and `OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS` **in installation `.env` only** (worker/web still default to `false` in the base `compose.yml` without the profile).
- Writes `compose.remote-http-dev.yml` and activates it automatically when `OSVA_REMOTE_HTTP_DEV_PROFILE=true`.

Reconcile an existing install:

```bash
osva setup --remote-http-dev --yes
```

## Manual Compose overlay (`deploy/compose`)

From a repository clone:

```bash
cd deploy/compose
cp .env.example .env
# Set POSTGRES_PASSWORD, then add remote-http-dev variables (see .env.example comments)
docker compose -f compose.yml -f compose.remote-http-dev.yml up -d
```

## Docker networking

| Direction | Requirement |
| --- | --- |
| Worker → agent on host | Agent manifest endpoint must use a worker-reachable URL. On **Docker Desktop** (Windows/macOS), use `http://host.docker.internal:<agent-port>/…`. On **Linux**, the overlay adds `host.docker.internal:host-gateway` to the worker; override the agent URL if your bridge gateway differs. |
| Host agent → capability bridge | Use the published loopback URL (`OSVA_RUNTIME_CAPABILITY_BASE_URL`, default `http://127.0.0.1:8787`). |
| MCP connectors on host | With the dev profile, set connector transport URLs to `http://host.docker.internal:<port>` (or your platform’s equivalent). |

Do not bind the capability bridge on `0.0.0.0` on the **host** unless you understand exposure; the installation publishes **127.0.0.1** only.

## Model provider credentials

Credentials are **worker-only** and are not stored in the database or agent manifests.

1. Add to installation `.env` (never commit):

   ```env
   OPENAI_API_KEY=sk-...
   ```

2. Recreate the worker so Compose picks up env changes (other services unchanged):

   ```bash
   docker compose --project-directory <install-dir> up -d worker
   ```

   With the CLI-managed install, lifecycle commands use the same overlay when the profile is enabled:

   ```bash
   osva platform restart --install-dir <install-dir>
   ```

Use `ANTHROPIC_API_KEY` or `GOOGLE_GEMINI_API_KEY` instead when your ModelProfileVersion requires them.

## Workspace API key onboarding

Supported flows (no log scraping):

1. **`osva setup`** — after Console onboarding, create a workspace API key from Console (Settings) or use the one-time bootstrap output from the initial workspace bootstrap job when you run the bootstrap profile manually.
2. **Bootstrap profile (Compose)** — `docker compose --profile bootstrap run --rm bootstrap` prints `Workspace ID:` and `osva_ak_…` once; copy immediately.
3. **Additional keys (ADMIN)** — after human sign-in, `POST /v1/api-keys` with a session or an existing admin API key (see [`OSS-COMMUNITY-QUICKSTART.md`](../OSS-COMMUNITY-QUICKSTART.md)).

Configure external examples:

```powershell
$env:OSVA_BASE_URL = "http://127.0.0.1:8080"
$env:OSVA_API_KEY = "osva_ak_…"
```

## Security notes

- Private-network and MCP private-network flags are **operator opt-in** via the dev profile or explicit `.env` values.
- `OSVA_RUNTIME_CAPABILITY_ALLOW_PUBLIC_BIND=true` appears only inside the worker container for Docker port publishing; host publication remains loopback-scoped.
- Do not enable the remote-http-dev profile on internet-facing production hosts.

See also [`../platform/AGENT_RUNTIME.md`](../platform/AGENT_RUNTIME.md) and [`LOCAL_DEVELOPMENT.md`](LOCAL_DEVELOPMENT.md).
