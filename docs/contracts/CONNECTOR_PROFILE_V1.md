# Connector Profile V1

Connector Profile V1 defines the minimum MCP surface required for an out-of-process OSVA connector.

## Required MCP capabilities

An implementation MUST support:

- MCP initialization
- `tools/list`
- `tools/call`

Other MCP features (resources, prompts, sampling, roots, tasks, subscriptions) are optional and not required by OSVA Community 1.0.

## Transport

- **Streamable HTTP** is recommended for third-party or isolated connectors.
- **stdio** is supported for trusted operator-local execution. Launching a stdio command is local code execution and must be treated as a privileged operator action.

OSVA does not define a separate connector wire protocol. Connectors are MCP servers.

## Tool stability

Within a connector version:

- Tool names MUST remain stable.
- Imported OSVA ToolVersions snapshot remote tool name, description, and input schema at import time.
- Changing tool behavior or schema requires a new connector deployment/version and a new ToolVersion import.

## JSON input/output

- Tool inputs MUST be JSON-compatible objects matching the declared input schema.
- Tool outputs SHOULD return structured JSON via MCP `structuredContent` (or normalized text JSON) so OSVA MCP client result normalization succeeds.

## Errors

- Tool failures SHOULD map to MCP tool error results or structured error payloads.
- Connectors MUST NOT leak stack traces by default.

## Cancellation

- Connectors MUST propagate MCP cancellation / `AbortSignal` into long-running handlers where applicable.

## Retries

- Connector handlers MUST NOT auto-retry side-effecting operations. Retries belong to OSVA orchestration when idempotency is known.

## Pagination

- OSVA does not define a connector pagination protocol. Connectors MAY expose cursor fields inside their own tool schemas.

## Security

- Connector endpoints registered in OSVA are trusted control-plane configuration in Community 3.6.
- HTTP auth to connectors uses SecretReference-backed bearer/header configuration.
- stdio secret values MUST be configured via `secretEnvironment` SecretReferences, resolved only at child process startup.

## Immutable import behavior

Discovery lists remote tools. Import creates immutable ToolVersions bound on AgentVersions. Execution always flows:

```text
Runtime → ToolGateway → ToolVersion → ConnectorVersion → MCP client → connector
```

Inbound OSVA MCP (Stage 3.6) is a separate surface and does not replace connector execution.
