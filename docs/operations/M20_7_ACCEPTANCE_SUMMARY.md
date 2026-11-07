# M20.7 acceptance summary

**Branch:** `feat/m20-7-live-builder-acceptance`  
**Harness:** `m20-7.1`  
**Baseline:** `origin/main` (M20.6 merged)

## M20.7.1 engineering acceptance

| Verdict | Value |
|---------|--------|
| **M20.7.1 engineering acceptance** | **PASS** (harness, guards, regression; no billable calls) |
| **Live OpenAI** | **NOT_RUN** |
| **Live Gemini** | **NOT_RUN** |
| **Product readiness** | **NO-GO** pending live provider evidence |

Verified this closeout (local, no billable API):

| Check | Result |
|-------|--------|
| `pnpm acceptance:m20-7:test` | 15/15 PASS |
| `pnpm acceptance:m20-7:regression` | 6/6 PASS (Vitest integration) |
| `pnpm acceptance:m20-6:test` | 5/5 PASS |
| `pnpm acceptance:m20-6:smoke` | 5/5 PASS (reused from same branch session; matrix logic unchanged) |
| `@osva/console` lint + typecheck | PASS (turbo: 35 cached / 2 executed) |
| Prettier (all branch-changed supported files) | write + check PASS |
| `git diff --check` | PASS |

Live-ready stack (integration + unit evidence, no external providers):

- No fake OpenAI listener in `live-ready` profile (`fakeOpenAI === undefined`).
- Provisioning pins official URLs only; loopback/fake origins rejected.
- Client responses: regression reuses `assertNoSentinelLeak` patterns; redaction tests PASS.
- Budgets: pre-request reservation + required `OSVA_M20_7_MAX_COST_USD_MICROS` in live preflight (unit tests J/K/L/O).
- Failed prerequisites block before vitest live execute (`OSVA_M20_7_ALLOW_BILLABLE` gate).
- Provenance fail-closed: no `liveProviderCalls` without verified identity + observed calls.
- Workflow run count unchanged in live preflight integration test.

**Remaining gap for product GO:** operator live smoke with `OSVA_M20_7_ALLOW_BILLABLE=1`, verified `actualProviderCallsObserved > 0`, and intent scoring on real model output.

## Confirmed M20.6 live gaps

1. **Fake provider routing** — live flag still used M12.3 fake OpenAI + fixture `baseUrl`.
2. **Unverified live evidence** — runner set `liveProviderCalls` when env looked “live”.
3. **Soft budgets** — M20.6 `budgetExceeded` only post-hoc; no pre-request reservation or required cost cap.

## Corrected entrypoints

| Command | Purpose |
|---------|---------|
| `pnpm acceptance:m20-6` | Deterministic matrix only |
| `pnpm acceptance:m20-7:preflight` | Validates credentials, models, budgets; **no** provider HTTP |
| `pnpm acceptance:m20-7:regression` | Integration routing/regression |
| `pnpm acceptance:m20-7:live` | Live path; billable calls need `OSVA_M20_7_LIVE_EXECUTE` + `OSVA_M20_7_ALLOW_BILLABLE` |

Legacy `pnpm acceptance:m20-6:live` forwards to M20.7 preflight and does **not** claim live provider success.

## Prerequisites for real live smoke (operator)

1. Isolated disposable Postgres/Valkey (harness-managed).
2. `OSVA_M20_7_LIVE=1`, `OSVA_M20_7_ISOLATED=1`, `OSVA_M20_7_LIVE_EXECUTE=1`, `OSVA_M20_7_ALLOW_BILLABLE=1`.
3. `OSVA_M20_7_MAX_COST_USD_MICROS` and token/request budgets set.
4. Real `OPENAI_API_KEY` or `GOOGLE_GEMINI_API_KEY` in env (never committed).
5. `OSVA_M20_7_GENERATION_MODEL` / `OSVA_M20_7_EXECUTION_MODEL` set to authorized catalog models.
6. Run preflight, then `pnpm acceptance:m20-7:live -- --provider=openai --smoke`.
7. Inspect `artifacts/m20-7/acceptance-results.json` for `providerIdentityVerified` and `actualProviderCallsObserved > 0`.

## Failure diagnosis

| Symptom | Likely cause |
|---------|----------------|
| `CI_LIVE_BLOCKED` | Running live in CI without `OSVA_M20_7_ALLOW_CI_LIVE=1` |
| `OSVA_M20_7_MAX_COST_USD_MICROS required` | Missing cost cap |
| `FAKE_PROVIDER_ENDPOINT_IN_LIVE_MODE` | Connection still points at loopback fixture |
| `LIVE_PASS_WITHOUT_VERIFIED_PROVIDER_PROVENANCE` | Report claims PASS without observed real adapter calls |
| `BILLABLE_CALLS_DISABLED_FOR_M20_7_1` | Expected during M20.7.1; enable `OSVA_M20_7_ALLOW_BILLABLE` for smoke |

## Cleanup

Stop Docker test containers via harness `afterAll`; delete local `artifacts/m20-7/` as needed (gitignored).
