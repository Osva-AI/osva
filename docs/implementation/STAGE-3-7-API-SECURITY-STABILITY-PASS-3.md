# Stage 3.7 — API Security and Stability (Pass 3)

Pass 3 converges public client contracts and MCP connector security on the Pass 1+2 control-plane model.

## Frozen from Pass 1 + Pass 2

```text
API key → RequestPrincipal → ControlPlaneScope → workspace-scoped lookup → authorization → application → PostgreSQL
```

Tenant semantics: foreign workspace **404**, in-workspace RBAC **403**.

## Pass 3 segments

| Segment | Summary |
|---------|---------|
| A | Removed `workspaceId` from public mutating request contracts; TS/Python SDK + CLI authenticate with `apiKey` / `OSVA_API_KEY` only |
| B | `GET/POST /v1/api-keys`, `POST /v1/api-keys/:apiKeyId/revoke`; domain list/revoke; ADMIN; inventory updated |
| C | MCP auth via `GET /v1/auth/context`; legacy env bearer removed; request-scoped bearer credential + secret-free `McpPrincipal` |
| D | `McpConnectorExecutionConfig` for adapters; public connector GET/list redacts `SecretReference.key` |
| E | `@osva/outbound-network` shared from REMOTE_HTTP pinned policy |
| F | MCP `STREAMABLE_HTTP` uses `createPinnedOutboundFetch`; no redirects; `OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS` |
| G | `OSVA_MCP_STDIO_CONNECTORS_ENABLED` default `false`; ADMIN config + runtime gate before spawn |
| H | Targeted tests + this document |

## Operator configuration

| Variable | Default | Scope |
|----------|---------|--------|
| `OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS` | `false` | Web MCP client pool |
| `OSVA_MCP_STDIO_CONNECTORS_ENABLED` | `false` | Web connector app + MCP client pool |

Not tenant-configurable via connector versions, agents, or SDK callers.

## API-key routes

| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/api-keys` | ADMIN |
| POST | `/v1/api-keys` | ADMIN |
| POST | `/v1/api-keys/:apiKeyId/revoke` | ADMIN |

Canonical inventory: `apps/web/src/v1-route-inventory.ts`.

## MCP inbound auth

```text
Authorization: Bearer <osva_ak_…>
  → GET /v1/auth/context (control plane)
  → AuthenticatedMcpIdentity { principal: McpPrincipal, bearerCredential }
  → request-scoped OsvaClient(bearerCredential)
  → authenticated REST calls
```

## Connector contracts

- **Public REST:** `ConnectorVersionResourceV1` uses redacted auth (`configured: true`) and redacted stdio `secretEnvironment` bindings.
- **Execution:** `McpConnectorExecutionConfig` carries full transport + `SecretReference`s for `ManagedMcpClient` only.
- **Resolution:** `SecretResolver` at connection/process start only.

## Verification

Run `pnpm verify:quick` at integration checkpoints. Do not run `verify:ci:clean` in Pass 3.

Migrations `0000`–`0022` unchanged.
