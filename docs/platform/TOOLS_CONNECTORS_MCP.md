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

## Not supported in Stage 2.7

- MCP resources, prompts, sampling, roots
- elicitation / input-required interaction
- MCP Tasks / async MCP job lifecycle
- subscriptions / automatic tool-change sync
- OAuth browser flows and delegated user credentials
- legacy SSE as a first-class OSVA connector transport
- OSVA exposed as an MCP server
- provider-specific connectors (GitHub, Slack, etc.)

OSS 1.0 may later expose selected OSVA capabilities through an MCP server; that
requires separate architecture from this slice.
