# Tools, Connectors, and MCP

## Tool
Logical executable capability.

## ToolVersion
Immutable executable/schema definition.

## Connector
Package exposing Tools, triggers, or resources.

## ToolGateway

```text
Agent
→ ToolGateway
→ permission/policy
→ credential resolution
→ ToolVersion adapter
```

## MCP

Stage 2 adds MCP client capability.

OSS 1.0 may expose selected OSVA capabilities through an MCP server.
