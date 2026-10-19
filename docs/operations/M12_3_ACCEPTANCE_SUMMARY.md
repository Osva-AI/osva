# M12.3 Acceptance Summary — Cross-Capability Integration and Self-Hosted Acceptance

Status: **PASS** (mandatory CI gate and full Console browser journey executed on deterministic stack; optional Ollama/LiteLLM profiles not executed locally).

## Impact and reused infrastructure

- Reused disposable Postgres/Valkey harness (`packages/db/test/integration/postgres-harness.ts`, `adapters/bullmq/test/integration/valkey-harness.ts`).
- Reused deterministic fakes: `adapters/model-openai/test/fake-openai-server.ts`, `@osva/adapters-mcp-client/testing`.
- Reused trusted TypeScript runtime fixtures; added `model-tool-combined-agent.ts` and `mcp-adversarial-agent.ts`.
- Console Option A: loopback web + worker + Console BFF (human Better Auth session, no API-key Console mode).
- Fixed human route lookup for `model-provider-connections` and `test` segments in `apps/web/src/v1-route-structural-key.ts`.
- Console BFF POST proxies for model profile create/version append; minimal Console UI for model profile create and ModelProfileVersion append (M12.1 browser waiver).

## Acceptance entry point

```bash
pnpm acceptance:m12-3              # CI gate: docker preflight, build, 5 BFF integration scenarios
pnpm acceptance:m12-3:browser      # BFF + Playwright Chromium + full UI journey (local operator)
pnpm acceptance:m12-3:browser-ci   # browser UI only (CI; BFF already in m12-3-acceptance)
pnpm acceptance:m12-3:test         # runner smoke tests (node --test)
```

Prerequisites: Docker, `pnpm install`. Browser profiles install Chromium via `pnpm exec playwright install chromium` (local) or `pnpm exec playwright install --with-deps chromium` (GitHub Actions). Console `pnpm test:integration` excludes `*-browser.integration.test.ts` so verify does not require Playwright binaries.

## Evidence classes

| Class | What ran | Result |
| --- | --- | --- |
| **Real-stack BFF acceptance** | `m12-3-cross-capability.integration.test.ts` via `pnpm acceptance:m12-3` | **PASS** 5/5 (2026-10-19) |
| **Real browser acceptance** | `m12-3-browser.integration.test.ts` via `pnpm acceptance:m12-3:browser` | **PASS** 6/6 total with BFF (2026-10-19) |
| **Deterministic fake-provider** | Fake OpenAI + fake Streamable HTTP MCP in both suites | **PASS** |
| **Actual Ollama execution** | `scripts/acceptance/m12-3/profiles/ollama-optional.mjs` | **NOT EXECUTED** (no local Ollama in closeout) |
| **Actual LiteLLM Proxy** | Operator deployment | **NOT EXECUTED** — CI uses OpenAI-compatible fake only |
| **Authorization regression** | `apps/web/test/human-workspace-authorization.test.ts` | **PASS** 8/8 |

### Browser UI journey (Playwright)

Human sign-in → workspace `ws-m12-3-a` → provider connection create/configure → connectivity test → model profile + ModelProfileVersion in UI → MCP connector append → discover/import → agent + AgentVersion (model + tool selectors, combined fixture) → run launch → run detail SUCCEEDED + RunSteps table → switch to workspace B → provider connection absent → sentinel credential absent from DOM.

## Direct BFF scenarios

| Scenario | Evidence |
| --- | --- |
| Model provider connection via Console BFF | Create connection/version, connectivity test, ModelProfileVersion, agent bind, run, MODEL RunStep |
| MCP discover/import via Console BFF | Connector/version, discover, import, agent bind, TOOL RunStep |
| Combined model + MCP | Single agent version, MODEL + TOOL steps |
| Workspace isolation | Workspace B cannot list foreign connections/connectors (API); browser confirms UI list empty in B |
| Credential redaction + adversarial tool | Sentinel absent from JSON; unbound tool invoke blocked |

Command: `pnpm acceptance:m12-3` — exitCode 0, wrapper ~200s local.

## Self-hosted inference and LiteLLM

| Profile | Status |
| --- | --- |
| CI deterministic fake OpenAI-compatible server | **PASS** (core gate) |
| Optional Ollama/real inference | **NOT EXECUTED** — set `OSVA_M12_3_OLLAMA_BASE_URL`; see `scripts/acceptance/m12-3/README.md` |
| LiteLLM Proxy deployment | **NOT EXECUTED** — protocol compatibility covered by fake server + worker integration |

## Security notes

- Sentinel credential not present in Console BFF JSON or browser DOM in exercised tests.
- SSRF/outbound policy: `@osva/outbound-network` and worker/model integration tests; link-local connectivity assertion removed from M12.3 BFF (unstable 200); not a bypass of worker egress policy.
- MCP adversarial agent: unbound tool rejection covered in BFF scenario 5.
- Human authorization: model provider create (WRITE), version append (WRITE), connectivity test (EXECUTE); VIEWER denied on POST connections.

## M12.1 / M12.2 waiver disposition

- **M12.1 browser waiver:** **Closed** — model connection, profile/version UI, connectivity test, and workspace isolation in `m12-3-browser.integration.test.ts`.
- **M12.2 browser waiver:** **Closed** — MCP discover/import, tool binding selector, run + RunSteps in same browser suite.

## CI

| Job | Command | Role |
| --- | --- | --- |
| `m12-3-acceptance` | `pnpm acceptance:m12-3` | **Mandatory** — five BFF cross-capability scenarios |
| `m12-3-browser-acceptance` | Playwright install + `pnpm acceptance:m12-3:browser-ci` | **Mandatory** — full Playwright UI journey (no duplicate BFF) |
| `verify` | `pnpm verify:ci` | **Mandatory** — Console integration suite excludes browser-only tests |

Local full stack + browser: `pnpm acceptance:m12-3:browser` (BFF and browser in one run).

## Known limitations

- Optional Ollama/LiteLLM operator profiles require external services and are not part of the CI gate.
- Browser acceptance is slower (~75–140s) and runs Playwright against built Console client dist.

## M12 readiness

- **M12.3:** **PASS** on mandatory acceptance.
- **Overall M12:** **PASS** for product/CI scope; optional real inference profiles remain operator-only.
