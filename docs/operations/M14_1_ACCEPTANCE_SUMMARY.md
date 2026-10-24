# M14.1 Acceptance Summary — Tool and MCP Authorization Hardening

Status: **PASS** (focused verification recorded below; baseline `main` @ `744c1bbd8f968bc8c0293de5372fb9e59964286c`; no Git commit or push by implementation agent).

Prerequisite: M14.0 security audit and evidence-reconciliation addendum.

## Security invariant

ToolGateway must independently verify ToolVersion and MCP ConnectorVersion workspace ownership and ToolVersion identity on every invoke, failing closed before internal executors or MCP network/process calls. Binding membership remains enforced by trusted runtimes from frozen Run effective bindings; no new authorization framework was introduced.

## Layer ownership

| Check | Layer |
| --- | --- |
| Logical tool binding → ToolVersionId | Trusted runtime / capability bridge from `ExecutionRequest.toolVersionBindings` |
| Request vs authorization `toolVersionId` | ToolGateway |
| Parent Tool workspace | ToolGateway |
| MCP ConnectorVersion parent Connector workspace | ToolGateway (`invokeMcpToolVersion`) |
| Custom deny rules | Injectable `ToolPolicy` (`DefaultToolPolicy` remains a no-op hook) |

## Delivered behavior

- Cross-workspace ToolVersion invoke → `TOOL_VERSION_NOT_FOUND` (generic message).
- Cross-workspace MCP ConnectorVersion → `TOOL_IMPLEMENTATION_NOT_FOUND` (generic message).
- Mismatched request / authorization ToolVersion → `TOOL_NOT_AUTHORIZED`.
- Denied paths do not call internal implementations or `McpClientPool.invokeTool`.

## Automated test map

| Requirement | Primary tests |
| --- | --- |
| A–E, G–H | `packages/tool-gateway/test/tool-gateway.test.ts` |
| F | `adapters/runtime-http/test/capability-bridge.test.ts`, `adapters/runtime-typescript/test/trusted-typescript-runtime-adapter.test.ts` |
| I | Existing MCP harness + worker integration (unchanged paths) |
| J | `packages/observability` / gateway instrumentation pass-through of full `ToolInvokeRequest` |

## Verification evidence

| Command | Exit code | Cache / notes |
| --- | ---: | --- |
| `pnpm exec prettier --write` / `--check` (changed files) | 0 | Direct |
| `pnpm --filter @osva/tool-gateway lint` | 0 | Direct |
| `pnpm --filter @osva/tool-gateway typecheck` | 0 | Direct |
| `pnpm --filter @osva/tool-gateway test` | 0 | 22 tests, direct (Vitest transform not Turbo-cached) |
| `pnpm --filter @osva/adapters-runtime-http test -- capability-bridge.test.ts` | 0 | 8 tests, direct |
| `pnpm --filter @osva-ai/contracts test` | 0 | 136 tests, direct |
| `pnpm --filter @osva/worker test:integration -- mcp-tool-gateway.integration.test.ts` | 0 | 2 tests, Docker Postgres/Valkey (direct Vitest) |
| `node scripts/release/docs-link-check.mjs` | 0 | 134 markdown files |
| `git diff --check` | 0 | Direct |
| `pnpm verify:changed` | 0 | Turbo lint/typecheck/test/build: mixed cache miss (contracts/tool-gateway lint & typecheck) and cache hit (dependency builds) |

Not executed: `pnpm verify:ci:clean` (reserved for operator pre-merge per playbook).
