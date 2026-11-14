# B7.2 — GitHub connector operational acceptance

**Milestone:** B7.2
**Target package:** `@osva-ai/connector-github@0.4.0` (SDK `@osva-ai/connector-sdk@1.1.4`)
**Branch:** `feat/b7-2-github-connector-operational-acceptance`

## Architecture and reuse

| Area | Decision |
| --- | --- |
| B7.1 STDIO worker harness | **Reuse** `b7-1-stdio-runtime-harness.ts` (register/discover/import/run/steps) |
| GitHub mock | **Reuse** `packages/tool-gateway/test/fixtures/mock-github-http-server.ts` |
| GitHub stdio fixture | **Reuse** osva-connectors `stdio-github-fixture.js` resolution helpers |
| ToolGateway compatibility matrix | **Reuse** `@osva/tool-gateway` github suite (no duplicate coverage) |
| Production ToolGateway | **Unchanged** — no GitHub-specific branches |
| `SecretResolver` | **Reuse** worker/web `ProcessEnvSecretResolver` |

B7.2 adds worker-level Run/RunStep evidence and published-package lanes; it does not replace M12.4.2 ToolGateway-only tests.

## Published package pin

| Field | Value |
| --- | --- |
| Package | `@osva-ai/connector-github` |
| Version | `0.4.0` (verified via `npm view` during `acceptance:b7-2:prepare`) |
| STDIO entry | `dist/stdio.js` |
| MCP tool (live lane only) | `github.repository.get` |

## Token permission requirements

Live lane only:

- Fine-grained GitHub PAT with **read-only Metadata** on **`Osva-AI/osva`**
- **No** Issues write, **no** additional repositories
- Supplied only via env var `B7_2_GITHUB_OPERATOR_PAT` on the operator machine (untracked)

Fixture lane uses sentinel `GITHUB_CONNECTOR_TEST_PAT=ghp_osva_test_fixture_…` against the loopback mock.

## SecretReference configuration

Persisted `ConnectorVersion.transportConfig.secretEnvironment`:

```json
{
  "OSVA_CONNECTOR_GITHUB_TOKEN": { "key": "<SecretReference key>" }
}
```

| Lane | SecretReference key | Resolved from |
| --- | --- | --- |
| Fixture | `GITHUB_CONNECTOR_TEST_PAT` | Web + worker process env |
| Live | `B7_2_GITHUB_OPERATOR_PAT` | Web + worker process env |

The token value never appears in ConnectorVersion HTTP responses, manifests, or acceptance artifacts.

## Deterministic fixture acceptance — FIXTURE_BACKED_RUNTIME_ACCEPTANCE

| Item | Detail |
| --- | --- |
| Command | `pnpm acceptance:b7-2:fixture` |
| Spec | `apps/worker/test/integration/b7-2-fixture-backed-runtime-acceptance.integration.test.ts` |
| GitHub API | Loopback mock (`OSVA_CONNECTOR_GITHUB_TEST_API_BASE_URL`) |
| Stdio | osva-connectors `stdio-github-fixture.js` (supports loopback mock via `OSVA_CONNECTOR_GITHUB_TEST_API_BASE_URL`) |
| Prepare | **Not** used for fixture lane — `acceptance:b7-2:prepare` is for **live** published `dist/stdio.js` only |

Scenarios with Run/RunStep assertions:

1. Happy path `github.repository.get`
2. Missing secret at discover
3. Invalid credential → failed TOOL step
4. 404 (`not_found` mock mode)
5. 5xx sanitized diagnostics
6. Unbound logical tool (no provider call)
7. Worker STDIO gate off
8. Web STDIO gate off

Deferred to `@osva/tool-gateway` harness: foreign-workspace denial, cancellation timing, `TOOL_NOT_AUTHORIZED` policy matrix.

## Published live acceptance — PUBLISHED_ARTIFACT_LIVE_ACCEPTANCE

| Item | Detail |
| --- | --- |
| Prepare | `pnpm acceptance:b7-2:prepare` |
| Run | `pnpm acceptance:b7-2:published` (requires `B7_2_GITHUB_OPERATOR_PAT`) |
| Spec | `apps/worker/test/integration/b7-2-published-artifact-operational.integration.test.ts` |
| Tool | **Only** `github.repository.get` imported |
| Input | `{ "owner": "Osva-AI", "repo": "osva" }` |

## Local verification evidence (2026-11-14)

| Command | Result |
| --- | --- |
| `pnpm acceptance:b7-2:test` | **PASS** |
| `pnpm acceptance:b7-2:prepare` | **PASS** (registry `0.4.0` verified; manifest in `artifacts/acceptance/b7-2/`) |
| `pnpm acceptance:b7-2:fixture` | **FAIL** (local) — MCP discover `500` / stdio subprocess `Connection closed`; same symptom as `pnpm --filter @osva/tool-gateway test:integration:github-connector` on this machine |
| `pnpm acceptance:b7-2:published` | **NOT_RUN** — `B7_2_GITHUB_OPERATOR_PAT` not configured |
| `pnpm acceptance:b7-1:fixture` (regression) | **PASS** |
| `pnpm --filter @osva/worker typecheck` / `lint` | **PASS** |
| `prettier --check` (changed paths) | **PASS** after format |
| `git diff --check` | **PASS** |

**Published live status:** `PUBLISHED_ARTIFACT_LIVE_NOT_RUN` until operator sets `B7_2_GITHUB_OPERATOR_PAT` and runs `pnpm acceptance:b7-2:published`.

## Redaction / security

Automated checks assert absent from public JSON:

- Fixture PAT sentinel and `DO_NOT_LEAK_IN_TOOL_OUTPUT`
- Live operator PAT (when lane runs)
- Secret reference keys **may** appear; resolved secret values **must not**

## Cleanup

- Tests stop web/worker in `finally`; Postgres/Valkey containers in `afterAll`
- Published consumer dir listed in `artifacts/acceptance/b7-2/consumer-manifest.json` (no token)

## Troubleshooting — STDIO discover / `Connection closed`

Symptoms: discover HTTP 500, ToolGateway `SdkError: Connection closed`, MCP child exits during startup (no handshake).

Common cause: a machine-level `OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY` (or similar) pointing at a checkout where `node_modules` is missing (`@osva-ai/connector-sdk` not resolvable). The MCP child process receives only operator-configured env vars plus MCP SDK default inheritance — not the full parent shell — so the fixture must resolve imports from its connector checkout.

Mitigations:

- Prefer `OSVA_CONNECTORS_ROOT` to the built osva-connectors tree; `pnpm acceptance:b7-2:fixture` clears stale explicit entry overrides when it sets the root.
- ToolGateway resolution ignores an explicit stdio entry path that exists on disk but cannot resolve fixture dependencies, then falls back to `OSVA_CONNECTORS_ROOT` + the documented relative fixture path (Node.js ESM resolves packages via the fixture script location and ancestor `node_modules`, not `NODE_PATH`).

## Known limitations

- Fixture lane requires a built osva-connectors stdio fixture (not vendored in osva core)
- Mock does not model GitHub 403 separately (401/404/5xx covered)
- Live lane requires outbound HTTPS to `api.github.com`

## B7.3 prerequisites

- Additional read-only connectors (Shopify, GA4, …) using the same two-lane pattern
- Optional CI job for B7.2 fixture lane when `OSVA_CONNECTORS_ROOT` is available

## Status legend

| Label | Meaning |
| --- | --- |
| **PASS** | Executed successfully |
| **FAIL** | Executed and failed |
| **NOT_RUN** | Operator lane not executed |
| **SKIPPED** | Fixture or live gate not satisfied |