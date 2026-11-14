# B7.1 — Published npm connector operational acceptance

**Milestone:** B7.1
**Target package:** `@osva-ai/connector-npm@0.1.1` (SDK peer `@osva-ai/connector-sdk@1.1.4`)
**Node:** 24+
**Branch:** `feat/b7-1-npm-connector-operational-acceptance`

## Architecture impact inventory

| Area | Impact |
| --- | --- |
| Worker integration tests | New STDIO end-to-end harness and acceptance specs |
| Web / worker runtime | **No code changes** — existing `OSVA_MCP_STDIO_CONNECTORS_ENABLED` gate and Connector APIs |
| ToolGateway / McpClientPool | **Reused** — no second MCP runtime |
| Console | **None** — registration via existing HTTP APIs only |
| Database | **No migrations** |
| Published connector | **Not modified** — consumed from npm install only |

## Build vs reuse

| Capability | Decision |
| --- | --- |
| Postgres / Valkey harness | Reuse `packages/db` and `adapters/bullmq` integration harnesses |
| Web + worker processes | Reuse `createWebProcess` / `createWorkerProcess` from integration tests |
| STDIO subprocess (fixture) | Reuse `adapters/mcp-client/test/fake-stdio-mcp-server.mjs` |
| STDIO subprocess (published) | Operator install of pinned `@osva-ai/connector-npm@0.1.1` → `dist/stdio.js` |
| Tool import / Run API | Reuse existing `/v1/connectors/*`, `/v1/runs` |
| Trusted TypeScript agents | New thin fixtures `mcp-npm-metadata-agent.ts`, `mcp-stdio-error-agent.ts` |
| ToolGateway security matrix | Reuse `@osva/tool-gateway` connector compatibility harness (foreign workspace, cancellation, etc.) |

## Published npm package pin

| Field | Value |
| --- | --- |
| Package | `@osva-ai/connector-npm` |
| Version | `0.1.1` |
| SDK dependency | `@osva-ai/connector-sdk@1.1.4` |
| STDIO entry | `dist/stdio.js` (resolved after install) |
| Catalog snapshot | `apps/console/src/client/data/osva-connectors-catalog.snapshot.json` (`publishedVersion: 0.1.1`) |

## Package installation procedure (operator-initiated)

```powershell
cd C:\path\to\osva
pnpm acceptance:b7-1:prepare
```

Writes `artifacts/acceptance/b7-1/consumer-manifest.json` with install root, provenance fields, and absolute `stdioEntry`. Does **not** install globally or at worker runtime.

## STDIO operator requirements

Enable on **web** (discover/import) and **worker** (tool execution):

```env
OSVA_MCP_STDIO_CONNECTORS_ENABLED=true
```

Console cannot enable this flag. ConnectorVersion must use `command: <node>` and `args: [<verified dist/stdio.js path>]` — no browser-supplied arbitrary executables.

## Deterministic fixture acceptance — FIXTURE_BACKED_RUNTIME_ACCEPTANCE

| Item | Detail |
| --- | --- |
| Command | `pnpm acceptance:b7-1:fixture` |
| Spec | `apps/worker/test/integration/b7-1-fixture-backed-runtime-acceptance.integration.test.ts` |
| MCP | Built-in fake STDIO MCP (`echo`, `error`, …) |
| Registry | **None** |
| Verdict label | **FIXTURE_BACKED_RUNTIME_ACCEPTANCE** — not published-provider acceptance |

## Published artifact live acceptance

| Item | Detail |
| --- | --- |
| Command | `pnpm acceptance:b7-1:published` |
| Spec | `apps/worker/test/integration/b7-1-published-artifact-operational.integration.test.ts` |
| Env gate | `OSVA_B7_1_PUBLISHED_ARTIFACT_LANE=1` + `OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY` |
| Tool invoked | `npm_package_metadata` with `{ "packageName": "lodash" }` |
| Assertions | Stable object shape (`name` string), not brittle registry field values |
| Default CI | **NOT RUN** |

**Status (this branch, local operator run 2026-11-14):** **PASS** — see evidence table below.

## AgentVersion configuration

Trusted TypeScript agent `mcp-npm-metadata-agent.ts` binds logical tool `npm_package_metadata` to imported ToolVersion. Fixture lane uses `mcp-echo-agent.ts` with binding `echo`.

## Execution and RunStep evidence

Success criteria (both lanes where applicable):

- Run and RunAttempt **SUCCEEDED**
- Effective bindings include imported ToolVersion id
- At least one persisted **TOOL** RunStep via `GET /v1/runs/{runId}/attempts/{runAttemptId}/steps`
- TOOL step `toolVersionId` matches binding; no synthetic DB shortcuts

## Security acceptance

| # | Check | Fixture lane |
| --- | --- | --- |
| 1 | STDIO disabled by default | Web rejects STDIO ConnectorVersion when gate off |
| 2 | Operator gate on worker | Run **FAILED** when worker gate off |
| 3–5 | Tool authorization | Unbound logical tool → no TOOL step; foreign workspace → tool-gateway harness |
| 6 | No credentials in ConnectorVersion | Fixture STDIO uses empty `secretEnvironment` |
| 7 | No arbitrary path from agent input | Entry path only from operator manifest / env |
| 8 | No runtime npm install | Prepare is separate operator step |
| 9 | Sanitized MCP errors | `error` tool — no raw marker in RunStep JSON |
| 10–13 | Cancellation / cleanup | Referenced in tool-gateway harness; worker stops close pools in `finally` |

## Error and recovery behavior (fixture)

| Scenario | Observable outcome |
| --- | --- |
| Missing STDIO entry | Discover fails (HTTP ≥ 400) |
| MCP tool error | TOOL RunStep **FAILED**, sanitized `errorCode` |
| Unbound tool | SUCCEEDED run, agent catches `TOOL_BINDING_NOT_FOUND` |
| Worker STDIO gate off | Run **FAILED**, failed TOOL step |

## Local verification evidence (2026-11-14)

| Command | Result |
| --- | --- |
| `pnpm acceptance:b7-1:test` | **PASS** (2/2) |
| `pnpm acceptance:b7-1:fixture` | **PASS** (6/6) — FIXTURE_BACKED_RUNTIME_ACCEPTANCE |
| `pnpm acceptance:b7-1:prepare` | **PASS** — manifest `artifacts/acceptance/b7-1/consumer-manifest.json` |
| `pnpm acceptance:b7-1:published` | **PASS** (2/2) — PUBLISHED_ARTIFACT |
| `pnpm --filter @osva/worker typecheck` | **PASS** |
| `pnpm --filter @osva/worker lint` | **PASS** |
| `prettier --check` (changed paths) | **PASS** |
| `git diff --check` | **PASS** |

### Published artifact run evidence (operator)

| Field | Value |
| --- | --- |
| Run id | `287e3fbb-db42-45da-9e54-2dbc95bedd9c` |
| RunAttempt id | `d60c28b9-882b-49a6-a07b-c1d63ff3db91` |
| RunStep id (TOOL) | `8c712424-afbd-4c04-84a5-3afc51bc6cee` |
| ConnectorVersion id | `7be72fa4-f2a4-4d24-a342-d8e9dd60a5a8` |
| ToolVersion id | `d3bcb0a3-c23a-48d8-b880-8bc236001fc9` |
| AgentVersion id | `31047b15-1fcc-48c4-a2ee-15a8ef054dcf` |
| Package pin | `@osva-ai/connector-npm@0.1.1` / `@osva-ai/connector-sdk@1.1.4` |
| STDIO entry | Temp consumer `dist/stdio.js` (see manifest) |
| Input | `{ "packageName": "lodash" }` |
| Terminal status | **SUCCEEDED** |

## Verification results

Suggested sequence for replay:

1. `pnpm exec prettier --write` on changed paths
2. `pnpm exec prettier --check` on changed paths
3. `pnpm --filter @osva/worker lint`
4. `pnpm --filter @osva/worker typecheck`
5. `pnpm acceptance:b7-1:test`
6. `pnpm acceptance:b7-1:fixture`
7. (Operator) `pnpm acceptance:b7-1:prepare` + `pnpm acceptance:b7-1:published`
8. `git diff --check`

## CI integration recommendations

- Add **optional** job running `pnpm acceptance:b7-1:fixture` when Docker integration is available.
- Do **not** wire `acceptance:b7-1:published` into default CI or install hooks.

## Operational limitations

- Live npm registry latency and rate limits affect published lane only.
- Published lane requires outbound HTTPS from the connector subprocess (read-only registry).
- Windows path resolution: use manifest from `acceptance:b7-1:prepare` or explicit env var.

## Cleanup

- Fixture tests: worker/web stop in `finally`; containers stopped in `afterAll`.
- Prepare: temp consumer dir documented in manifest; operator may delete `consumerWorkRoot`.

## Remaining B7.2 prerequisites

- Broader connector catalog live lanes (GitHub, Shopify, …) per B6.3D runbook
- Optional CI shard for published-artifact replay on release tags
- Console journey recording for published npm evidence (optional)

## Status legend

| Label | Meaning |
| --- | --- |
| **PASS** | Executed successfully with recorded evidence |
| **FAIL** | Executed and failed |
| **NOT_RUN** | Operator lane not executed |
| **SKIPPED** | Guarded test skipped (e.g. published lane without env) |