# M12.2 Acceptance Summary — Tools, Connectors, and MCP Discovery

## Scope delivered

- Console **Tools** navigation and BFF proxies for `/v1/tools` and `/v1/connectors` (including discover, import, PATCH metadata).
- Tool list/detail, connector list/detail, Streamable HTTP ConnectorVersion append, MCP discovery, review-before-import, and post-import navigation.
- AgentVersion **tool binding selector** preserving model bindings and advanced manifest JSON fields.
- BFF redaction tests for connector version list responses (no secret reference keys in JSON).

## Verification (direct)

| Command | Result |
| --- | --- |
| `pnpm --filter @osva/console exec tsc -p tsconfig.server.json` | PASS |
| `pnpm --filter @osva/console exec tsc -p tsconfig.client.json` | PASS |
| `pnpm --filter @osva/console exec vitest run test/agent-tool-bindings.test.ts test/tools-page.test.tsx test/server.test.ts` | PASS (41 tests) |
| `pnpm --filter @osva/web exec vitest run test/connector-http.test.ts` | PASS (7 tests) |
| `pnpm --filter @osva/worker exec vitest run --config vitest.integration.config.ts test/integration/mcp-tool-gateway.integration.test.ts` | PASS (2 tests) |
| `pnpm verify:changed` | PASS (~289s; affected `@osva/console`, `@osva/tool-gateway` from pre-existing working-tree scope) |

## Waivers / deferred (M12.3)

- Full Compose + Console browser acceptance matrix for tools/connectors (carried from M12.1 model waiver).
- Dedicated `scripts/acceptance/*` scenario for MCP discovery/import journey.
- STDIO connector creation through Console (intentionally restricted; read-only display only).

## Status

**PASS** for M12.2 Console + BFF slice and existing ToolGateway MCP integration evidence. Full Compose browser acceptance remains deferred to M12.3.
