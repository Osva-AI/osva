# OSVA Console (`apps/console`)

`apps/web` is the OSVA public control-plane API. `apps/console` is the browser-based developer/operator product console.

The console never connects to PostgreSQL directly and never exposes the workspace API key to the browser. The browser talks only to the console origin; the console server holds `OSVA_CONSOLE_API_KEY` and calls `apps/web` `/v1` endpoints through `@osva-ai/sdk`.

## Required environment

| Variable | Purpose |
| --- | --- |
| `OSVA_CONSOLE_API_KEY` | Workspace API key used server-side only |
| `OSVA_BASE_URL` | Control plane base URL (default `http://127.0.0.1:3000`) |
| `OSVA_CONSOLE_HOST` | Console bind host (default `127.0.0.1`) |
| `OSVA_CONSOLE_PORT` | Console bind port (default `4174`) |

`OSVA_API_BASE_URL` is accepted as an alias for `OSVA_BASE_URL`.

## Run locally

1. Start infrastructure and the control plane (`apps/web`) with a valid API key.
2. Build or run the console:

```bash
pnpm --filter @osva/console build
OSVA_CONSOLE_API_KEY=<key> pnpm --filter @osva/console start
```

Development (Vite + console API server):

```bash
OSVA_CONSOLE_API_KEY=<key> pnpm dev:console
```

Open the Vite dev URL (default `http://127.0.0.1:5173`). API calls are proxied to the console server.

## Security model

- API key stays on the console server process.
- Console API routes are an explicit allowlist (runs, attempts, steps, usage, artifacts metadata, auth context).
- No generic HTTP proxy.
- Responses are checked so the configured key cannot leak in JSON payloads.

## M8.1 supported surfaces

Read-only Runs experience:

- Runs list with `status`, `agentId`, `agentVersionId`, and cursor pagination
- Run detail (bindings, input, attempts)
- RunAttempt detail (output, error)
- RunStep activity (MODEL / TOOL / MEMORY / KNOWLEDGE metadata)
- Attempt usage and artifact metadata
- Polling while runs/attempts are active

Workflows, agents, settings, mutations, and artifact preview/download are out of scope for M8.1.
