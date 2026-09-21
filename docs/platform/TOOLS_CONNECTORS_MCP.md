# Tools, Connectors, and MCP

## Tool

Logical executable capability.

## ToolVersion

Immutable executable/schema definition. MCP-backed tools use
`type: "MCP"` with an immutable snapshot of connector identity, remote tool
name, description, and input schema.

## Connector

Mutable control-plane identity for an external integration package.

## ConnectorVersion

Immutable MCP connector configuration:

```text
kind = MCP
transport = STREAMABLE_HTTP | STDIO
transportConfig
auth (secret references only)
```

Configuration changes create a new ConnectorVersion. Retries reuse the
effective ConnectorVersion already bound on the ToolVersion / Run.

## ToolGateway

```text
Runtime
→ logical tool binding
→ ToolGateway
→ permission/policy
→ immutable ToolVersion
→ internal catalog | MCP execution adapter
→ normalized ToolResult
→ RunStep observability
```

MCP does not bypass ToolGateway. Runtimes, SDKs, and remote HTTP runtimes do
not receive a raw MCP client.

## MCP client adapter

The `@osva/adapters-mcp-client` package owns MCP SDK transport setup, discovery,
execution, result normalization, and error mapping. MCP SDK types must not leak
into domain contracts.

Worker-local HTTP clients and stdio child processes are disposable execution
infrastructure. MCP request IDs, transport sessions, client instances, and
process IDs are not OSVA lifecycle identities.

## Discovery

```text
create Connector
→ create ConnectorVersion
→ POST .../discover (lists remote MCP tools)
→ POST /v1/connectors/import-mcp-tools (creates Tool + ToolVersion snapshots)
→ bind ToolVersion on AgentVersion
```

Discovery does not grant permission. Unbound MCP tools are rejected by
ToolGateway before any MCP network/process invocation.

## Supported in Stage 2.7

- Streamable HTTP MCP transport
- stdio MCP transport (lazy process reuse per ConnectorVersion)
- MCP tool discovery and import
- MCP tool execution through ToolGateway
- Bearer/header auth via secret references

## Inbound OSVA MCP server (Stage 3.6)

`apps/mcp-server` exposes Streamable HTTP MCP at `/mcp` for external clients.

- Authentication: environment-configured bearer tokens mapped to a workspace
- Tools: agent run, run get, workflow run, workflow run get (explicit version IDs)
- Resources: read-only `osva://v1/...` listings and item views filtered by workspace
- Implementation path: MCP server → `@osva/sdk` → `apps/web` (no DB/BullMQ in MCP server)

See `docs/implementation/STAGE-3-6-MCP-SERVER-CONNECTOR-SDK.md`.

## Connector Profile V1 + TypeScript SDK (Stage 3.6)

- Profile: `docs/contracts/CONNECTOR_PROFILE_V1.md`
- SDK: `@osva/connector-sdk` (`defineConnector`, `defineTool`, HTTP + stdio serving)
- Example: `examples/echo-connector`

stdio transport supports `secretEnvironment` SecretReferences (resolved at process start).

## Still not supported

- MCP prompts, sampling, roots, elicitation, MCP Tasks, subscriptions on inbound OSVA MCP
- OAuth/OIDC inbound MCP auth (deferred to Stage 3.7)
- Raw ToolVersion execution via inbound MCP
- Provider-specific bundled connectors
