# Stage 3.6 — MCP Server + Connector SDK

## Scope delivered

- Inbound OSVA MCP Server (`apps/mcp-server`) exposing Streamable HTTP at `/mcp`
- Bearer-token workspace authentication (environment configuration)
- MCP tools: `osva_agent_run_v1`, `osva_run_get_v1`, `osva_workflow_run_v1`, `osva_workflow_run_get_v1`
- MCP resources under `osva://v1/...` with workspace filtering
- `@osva/connector-sdk` for Connector Profile V1 MCP connectors (HTTP + stdio)
- stdio `secretEnvironment` SecretReference injection for outbound connectors
- Connector Profile V1 contract doc and echo connector example

## Inbound architecture

```text
External MCP client
  → apps/mcp-server (Streamable HTTP, bearer auth)
  → @osva/sdk (HTTP)
  → apps/web
  → orchestration / workflow orchestrator
  → worker
```

The MCP server does not access PostgreSQL, BullMQ, ToolGateway, or runtime adapters directly.

## Outbound architecture (unchanged)

```text
Agent runtime
  → ToolGateway
  → immutable ToolVersion
  → immutable ConnectorVersion
  → @osva/adapters-mcp-client
  → connector (@osva/connector-sdk or any Profile V1 MCP server)
```

## Authentication

Configure:

- `OSVA_API_BASE_URL` — OSVA web API base URL
- `OSVA_MCP_BEARER_TOKENS` — JSON array `[{"token":"...","workspaceId":"..."}]` (recommended), or legacy `token:workspaceId` comma-separated pairs when tokens do not contain `:`
- `OSVA_MCP_HOST`, `OSVA_MCP_PORT`, `OSVA_MCP_PATH` (optional)

Workspace identity is derived from the bearer token. MCP tool arguments cannot supply `workspaceId`.

## stdio secret environment

ConnectorVersion stdio transport JSON supports:

```json
{
  "command": "node",
  "args": ["dist/server.js"],
  "environment": { "LOG_LEVEL": "info" },
  "secretEnvironment": {
    "GITHUB_TOKEN": { "key": "GITHUB_CONNECTOR_TOKEN" }
  }
}
```

Duplicate keys in `environment` and `secretEnvironment` are rejected. Secret values are resolved only at stdio process startup.

## Trust boundaries

- MCP inbound: workspace isolation enforced in MCP layer using authenticated principal + SDK reads
- Outbound connectors: operator-trusted registration (SSRF hardening deferred to Stage 3.7)
- No SQL migration required for this slice

## Verification

```bash
pnpm --filter @osva/contracts test
pnpm --filter @osva/connector-sdk test
pnpm --filter @osva/mcp-server test
pnpm --filter @osva/adapters-mcp-client test
pnpm verify:quick
pnpm verify:ci:clean
```

## Deferred to Stage 3.7+

- Persisted API keys / OIDC / RBAC for MCP
- Broad REST workspace auth consistency
- MCP connector egress SSRF hardening
- Enterprise secret managers and governance
