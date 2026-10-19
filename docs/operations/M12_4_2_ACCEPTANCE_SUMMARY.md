# M12.4.2 Acceptance Summary — Generic Connector Compatibility

**M12.4.2 implementation status:** **PASS locally**

**Merge readiness:** **Pending hosted CI** (reusable GitHub Actions workflow requires validation on GitHub runners).

## Pre-commit audit evidence (2026-10-19)

| Item | Result |
| --- | --- |
| Real GitHub stdio connector integration | **10/10 PASS** (`pnpm --filter @osva/tool-gateway test:integration:github-connector` with built fixture) |
| Local connector revision (adjacent osva-connectors checkout) | `8e382248b34d0b829f4f27890ab8ae98849f9ca8` |
| CI pinned connector revision | `4ce706e335422275a667faf15a26dba3485b2daf` (`.github/workflows/github-connector-integration.yml`) |
| ToolGateway unit tests | **18/18 PASS** |
| Required integration when fixture absent | **Fail-closed** — `OSVA_REQUIRE_GITHUB_CONNECTOR_INTEGRATION=true` without stdio entry → suite fails (exit 1), not silent skip |
| GitHub assertion parity | Generic harness preserves all M12.4.1 GitHub integration assertions; adds unbound binding, foreign-workspace invoke deny, and MCP cancellation scenarios |
| Hosted CI | Reusable workflow configured; **awaiting GitHub Actions run** on PR/push |
| PostgreSQL connector compatibility | **Deferred** pending osva-connectors stdio fixture contract (`build:test-stdio-fixture` + documented `.build/` entry) |

Local integration used fixture path:

`packages/github/test/fixtures/.build/stdio-github-fixture.js` from adjacent osva-connectors checkout.

## Generic harness coverage

| Area | Evidence |
| --- | --- |
| Harness API | `packages/tool-gateway/test/fixtures/mcp-connector-compatibility.harness.ts` — `registerMcpConnectorCompatibilitySuite(case)` |
| Case types | `mcp-connector-compatibility.types.ts` |
| Test policies (binding / deny / workspace) | `test/fixtures/policies/test-tool-policies.ts` + unit tests |
| Stdio fixture resolution (reused) | `resolve-external-connector-stdio-entry.ts`, `resolve-github-connector-test-entry.ts` |

### Scenarios in harness (10 integration tests for GitHub case)

MCP discover/import/invoke, ToolPolicy deny, unbound binding deny, missing secret, stdio gate, cross-workspace discovery, foreign-workspace invoke deny, auth error sanitization (GitHub case), 5xx sanitization, MCP cancellation via `AbortSignal`.

## External connector tested

| Connector | Fixture | Pin / version |
| --- | --- | --- |
| GitHub (`@osva-ai/connector-github`) | `packages/github/test/fixtures/.build/stdio-github-fixture.js` | CI: `4ce706e…`; local run: `8e382248…` |
| PostgreSQL (`@osva-ai/connector-postgres`) | **Not available** on osva-connectors `main` (2026-10-19) | Deferred — [CONNECTOR_TOOL_GATEWAY_ACCEPTANCE.md](../engineering/CONNECTOR_TOOL_GATEWAY_ACCEPTANCE.md) |

## CI evidence

- Reusable workflow: `.github/workflows/connector-tool-gateway-integration-reusable.yml`
- GitHub caller: `.github/workflows/github-connector-integration.yml` → `workflow_call` with pinned SHA (no floating branch refs)
- Vitest entry points: `test:integration:github-connector`, `test:integration:connector-compatibility`
- **Hosted validation:** not yet recorded in this summary; required before merge sign-off

## Known gaps / deferred

1. **PostgreSQL second case** — osva-connectors lacks published stdio fixture contract; no OSVA core provider code added.
2. **Published npm connector-acceptance kit** — intentionally not shipped (harness remains private `@osva/tool-gateway` tests).
3. **Full worker E2E unbound binding** — worker integration; harness uses `RuntimeBindingToolPolicy` at ToolGateway boundary.

## Verification (closeout)

| Step | Command | Exit code |
| --- | --- | --- |
| Prettier write | `pnpm exec prettier --write docs/operations/M12_4_2_ACCEPTANCE_SUMMARY.md` | (see post-edit run) |
| Prettier check | `pnpm exec prettier --check docs/operations/M12_4_2_ACCEPTANCE_SUMMARY.md` | (see post-edit run) |
| ToolGateway lint | `pnpm --filter @osva/tool-gateway lint` | 0 |
| ToolGateway typecheck | `pnpm --filter @osva/tool-gateway typecheck` | 0 |
| Unit tests | `pnpm --filter @osva/tool-gateway test` | 0 (18 tests) |
| GitHub integration (fixture present) | `OSVA_REQUIRE_GITHUB_CONNECTOR_INTEGRATION=true` + `OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY=<path>` → `pnpm --filter @osva/tool-gateway test:integration:github-connector` | 0 (10 tests) |
| GitHub integration (fixture absent, require set) | Same with require only | 1 (fail-closed) |
| Docs link check | `node scripts/release/docs-link-check.mjs` | 0 |
| Whitespace | `git diff --check` | (see post-edit run) |
