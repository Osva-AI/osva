# B7.3 — Shopify + GA4 dual-connector operational acceptance

**Milestone:** B7.3
**Target packages:** `@osva-ai/connector-shopify@0.1.1`, `@osva-ai/connector-ga4@0.1.1` (SDK `@osva-ai/connector-sdk@1.1.4`)
**Branch:** `feat/b7-3-commerce-analytics-acceptance`
**Reference journey:** Console Example `21-commerce-growth-analyst` (read-only dual connector; no revenue reconciliation claim)

## Architecture impact inventory

| Area | Impact |
| --- | --- |
| Worker integration tests | New dual-connector harness, fixture + published lanes |
| ToolGateway test fixtures | Loopback Shopify/GA4 HTTP mocks; stdio test fixtures targeting osva-connectors `dist/` |
| Web / worker runtime | **Unchanged** — reuse `OSVA_MCP_STDIO_CONNECTORS_ENABLED` and Connector APIs |
| Production ToolGateway | **Unchanged** — no Shopify/GA4-specific branches |
| `SecretResolver` | **Reuse** worker/web `ProcessEnvSecretResolver` |
| Database | **No migrations** |
| Published connectors | **Not modified** — consumed from npm (live lane) or osva-connectors `dist/` (fixture lane) |
| Console / contracts | **Unchanged** |

## Reuse plan (no third acceptance framework)

| Capability | Decision |
| --- | --- |
| B7.1 STDIO worker harness | **Reuse** `b7-1-stdio-runtime-harness.ts` |
| B7.2 operational patterns | **Reuse** scripts under `scripts/acceptance/b7-3/` mirroring B7.2 layout |
| Provider mocks | **Reuse** osva-connectors mock implementations vendored under `packages/tool-gateway/test/fixtures/` |
| Stdio fixture resolution | **Reuse** `resolve-external-connector-stdio-entry.ts` |
| ToolGateway security matrix | **Reuse** `@osva/tool-gateway` connector compatibility harness for foreign-workspace, cancellation, `TOOL_NOT_AUTHORIZED` |
| Dual-read agent | **New** thin fixture `mcp-commerce-dual-read-agent.ts` (Example 21-style, attribution note) |

## Smallest implementation scope

1. Two immutable MCP `ConnectorVersion`s (Shopify + GA4) with separate `secretEnvironment` maps and imported read-only tools: `shopify.shop.get`, `ga4.property.get`.
2. One trusted TypeScript agent Run binding both tools; assert **two** distinct succeeded **TOOL** `RunStep`s on the same `RunAttempt`.
3. Fixture lane only in default CI path; published live lane operator-gated.
4. No production contract changes.

## Security boundaries

| Boundary | Enforcement |
| --- | --- |
| No Shopify `shpat_*` or Google SA JSON in Git / manifests / `RunStep` JSON | Sentinel values in mocks; `assertNoCommerceSecretLeakInJson` |
| Fixture stdio | Loopback-only API base URLs (`127.0.0.1` / `localhost`) |
| Live lane | Separate `FIXTURE_PASS` vs `LIVE_PASS`; live requires four operator env vars |
| Read-only tools only | Import whitelist; no order/product mutation or GA4 configuration tools |
| Attribution | Agent output includes explicit non-reconciliation note |
| Reconciliation | **Never** claim Shopify sales ≡ GA4 revenue without documented attribution/timezone/currency/measurement |

## Published package pins

| Field | Shopify | GA4 |
| --- | --- | --- |
| Package | `@osva-ai/connector-shopify` | `@osva-ai/connector-ga4` |
| Version | `0.1.1` | `0.1.1` |
| STDIO entry | `dist/stdio.js` | `dist/stdio.js` |
| MCP tools (lanes) | `shopify.shop.get` | `ga4.property.get` |

## SecretReference configuration

### Fixture lane

**Shopify** `ConnectorVersion.transportConfig`:

```json
{
  "environment": {
    "OSVA_CONNECTOR_SHOPIFY_SHOP": "osva-fixture.myshopify.com",
    "OSVA_CONNECTOR_SHOPIFY_TEST_GRAPHQL_URL": "<loopback mock graphqlUrl>"
  },
  "secretEnvironment": {
    "OSVA_CONNECTOR_SHOPIFY_ACCESS_TOKEN": { "key": "SHOPIFY_CONNECTOR_TEST_ACCESS_TOKEN" }
  }
}
```

**GA4** (fixture stdio uses static bearer against loopback; no `GOOGLE_APPLICATION_CREDENTIALS` on the version):

```json
{
  "environment": {
    "OSVA_CONNECTOR_GA4_PROPERTY_ID": "123456789",
    "OSVA_CONNECTOR_GA4_TEST_DATA_API_ORIGIN": "<mock dataApiOrigin>",
    "OSVA_CONNECTOR_GA4_TEST_ADMIN_API_ORIGIN": "<mock adminApiOrigin>"
  }
}
```

| Lane | SecretReference key | Resolved from |
| --- | --- | --- |
| Fixture Shopify token | `SHOPIFY_CONNECTOR_TEST_ACCESS_TOKEN` | Web + worker process env |

### Live lane (operator)

| SecretReference key | Connector env var | Purpose |
| --- | --- | --- |
| `B7_3_SHOPIFY_OPERATOR_ACCESS_TOKEN` | `OSVA_CONNECTOR_SHOPIFY_ACCESS_TOKEN` | Sandbox Admin API token |
| `B7_3_SHOPIFY_OPERATOR_SHOP` | `OSVA_CONNECTOR_SHOPIFY_SHOP` | Sandbox shop domain |
| `B7_3_GA4_OPERATOR_CREDENTIALS_PATH` | `GOOGLE_APPLICATION_CREDENTIALS` | Path to SA JSON (not committed) |
| `B7_3_GA4_OPERATOR_PROPERTY_ID` | `OSVA_CONNECTOR_GA4_PROPERTY_ID` | Numeric GA4 property |

## Deterministic fixture acceptance — FIXTURE_BACKED_RUNTIME_ACCEPTANCE

| Item | Detail |
| --- | --- |
| Command | `pnpm acceptance:b7-3:fixture` |
| Spec | `apps/worker/test/integration/b7-3-fixture-backed-runtime-acceptance.integration.test.ts` |
| Stdio | `packages/tool-gateway/test/fixtures/.build/stdio-shopify-fixture.js`, `stdio-ga4-fixture.js` |
| Provider APIs | Loopback mocks in `packages/tool-gateway/test/fixtures/mock-*-http-server.ts` |
| Prepare | **Not** used for fixture lane |

### Fixture scenarios (Run / RunStep evidence)

1. Dual happy path — one Run, two succeeded TOOL steps, combined output + attribution note
2. Missing Shopify secret at discover
3. Invalid Shopify token → failed TOOL step, no token leak
4. GA4 403 with Shopify step succeeded (failure isolation within one Run)
5. Shopify 5xx sanitized diagnostics
6. GA4 429 failed TOOL step
7. Worker STDIO gate off

Deferred to `@osva/tool-gateway` compatibility harness: foreign-workspace denial, cancellation timing, `TOOL_NOT_AUTHORIZED` policy matrix.

## Published live acceptance — PUBLISHED_ARTIFACT_LIVE_ACCEPTANCE

| Item | Detail |
| --- | --- |
| Prepare | `pnpm acceptance:b7-3:prepare` |
| Run | `pnpm acceptance:b7-3:published` |
| Spec | `apps/worker/test/integration/b7-3-published-artifact-operational.integration.test.ts` |
| Gate | `OSVA_B7_3_PUBLISHED_ARTIFACT_LANE=1` + manifest stdio paths + operator secrets |
| Default CI | **NOT RUN** |

## Operator commands

```bash
pnpm acceptance:b7-3:test
pnpm acceptance:b7-3:fixture
pnpm acceptance:b7-3:prepare   # live only
pnpm acceptance:b7-3:published # live only, operator secrets required
```

## Status legend

| Label | Meaning |
| --- | --- |
| **FIXTURE_PASS** | `acceptance:b7-3:fixture` succeeded |
| **FIXTURE_FAIL** | Fixture lane executed and failed |
| **FIXTURE_SKIP** | Fixture prerequisites missing |
| **LIVE_PASS** | Operator published lane succeeded |
| **LIVE_NOT_RUN** | Published lane not executed (expected until operator runs) |

## Known limitations

- Fixture lane requires built osva-connectors Shopify + GA4 packages and built osva stdio fixtures (not vendored connector source in osva core).
- Live lane requires outbound HTTPS to Shopify Admin API and Google Analytics APIs (sandbox/test resources only).
- Example 21 full six-tool analyst scope is **not** required for B7.3; only the dual read-only subset is in scope.

## Local verification evidence (2026-11-14)

| Command | Result |
| --- | --- |
| `pnpm acceptance:b7-3:test` | **PASS** (3/3 node:test) |
| `pnpm acceptance:b7-3:fixture` | **PASS** (7/7 vitest; dual TOOL RunSteps on one Run) |
| `pnpm acceptance:b7-3:prepare` | **PASS** (registry `0.1.1` verified; manifest in `artifacts/acceptance/b7-3/`) |
| `pnpm acceptance:b7-3:published` | **NOT_RUN** — operator Shopify/GA4 secrets not configured |
| `pnpm --filter @osva/worker typecheck` | **PASS** |

**Published live status:** `PUBLISHED_ARTIFACT_LIVE_NOT_RUN` until operator sets `B7_3_SHOPIFY_OPERATOR_*` and `B7_3_GA4_OPERATOR_*` and runs `pnpm acceptance:b7-3:published`.

**B7.3 operational readiness:** **FIXTURE_PASS** — deterministic acceptance complete. **LIVE_PASS** not claimed.