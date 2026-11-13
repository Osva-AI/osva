# B6.3C — Connector Agent Tool Binding and Execution Diagnostics

## Summary

Console slice completing the connector adoption journey from MCP ToolVersion import through AgentVersion binding, authorized Run launch, and Tool RunStep diagnostics. No new execution engine, ToolGateway, or agent builder — all mutations and execution reuse existing OSVA control plane APIs.

## Architecture reused

| Capability | Reuse |
|------------|--------|
| MCP discover/import | Existing connector detail APIs (`discover`, `import-mcp-tools`) |
| Tool registry | `useToolsCatalogQuery`, tool detail routes |
| Agent Studio | `AgentStudioV2Workspace`, `ToolVersionBindingSelector`, manifest validation (`validateAgentManifest` via `describeDeclarativeManifestValidation`) |
| Execution | Agent version test handoff, Run APIs, `RunStepTimeline` |
| Authorization | ToolGateway invariants preserved; navigation `toolVersionIds` hints revalidated client-side only |
| Diagnostics | Public `RunStep` fields + `TOOL_ERROR_CODES` from `@osva-ai/contracts` |

## Journey

1. Catalog / guided setup (B6.3A–B6.3B)
2. Workspace connector + ConnectorVersion
3. Discover & import → immutable ToolVersions
4. **B6.3C:** Import handoff panel → Agents list hints → Agent Studio preselection
5. Publish AgentVersion → authorized Run
6. Run Detail Tool RunSteps + sanitized error guidance

## Security boundaries

- Query `toolVersionIds` treated as untrusted hints; catalog revalidation before preselection.
- No automatic agent creation, no automatic Runs, no browser MCP execution.
- No secrets in URLs or diagnostic panels.
- Catalog mutation heuristics not presented as authorization metadata.

## Tests performed

Focused Vitest:

- `apps/console/test/connector-agent-integration.test.ts`
- `apps/console/test/connector-workspace-status.test.ts` (extended)
- Regression: `connector-catalog-setup.test.tsx`, `connector-guided-setup.test.ts`

See verification section in the milestone closeout report for command output.

## Known limitations

- Preselection does not modify published AgentVersions.
- RunStep UI shows only API-provided fields (no raw provider payloads).
- Live Shopify, GA4, and GitHub acceptance not claimed unless explicitly evidenced elsewhere.
- STDIO connector health is operator-scoped; Console does not infer reachability.

## B6.3D prerequisites

- Live acceptance harness for catalog connectors (optional operator-driven).
- Deeper connector↔Run correlation when public contracts expose correlation ids on RunSteps.
- Expanded keyboard regression for Agent Studio equip stage with preselected rows.
