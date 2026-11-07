# M20.6 acceptance summary (operator)

## Prerequisites

- Docker (PostgreSQL + Valkey test containers)
- `pnpm install`
- For browser step: `pnpm exec playwright install chromium`

## Deterministic gate (default)

```powershell
pnpm acceptance:m20-6:test
pnpm acceptance:m20-6:smoke
```

Full disposable stack + optional browser:

```powershell
pnpm acceptance:m20-6
pnpm acceptance:m20-6:browser
```

**Provider calls:** none (fake OpenAI keyed by `OSVA_M20_6_SCENARIO` markers).

On Windows, the runner invokes `pnpm.cmd` with `shell: true` (Node cannot spawn `.cmd` without a shell). Docker preflight uses `node` with `shell: false` so paths under `Program Files` remain valid.

## Live OpenAI (optional)

```powershell
$env:OSVA_M20_6_LIVE = "1"
$env:OPENAI_API_KEY = "<from-secret-store>"
pnpm acceptance:m20-6:live -- --provider=openai --smoke
```

## Live Gemini (optional)

```powershell
$env:OSVA_M20_6_LIVE = "1"
$env:GOOGLE_GEMINI_API_KEY = "<from-secret-store>"
pnpm acceptance:m20-6:live -- --provider=gemini --smoke
```

Configure workspace model profiles to use live endpoints before running live mode. Without credentials, the runner completes harness self-tests and records `LIVE_PROVIDER_NOT_RUN` / blocked prerequisite (integration matrix skipped when blocked).

## Evidence

After a run, inspect (local only, gitignored):

- `artifacts/m20-6/acceptance-results.json`
- `artifacts/m20-6/acceptance-report.md`

## Measured results (engineering acceptance — 2026-11-08)

**Workstation:** Windows, branch `feat/m20-6-builder-product-acceptance` (uncommitted), deterministic mode.

| Gate | Result |
| --- | --- |
| `pnpm acceptance:m20-6:test` | **PASS** (5/5 harness tests) |
| `pnpm acceptance:m20-6` (`node scripts/acceptance/m20-6/run.mjs`) | **PASS** |
| `pnpm acceptance:m20-6:browser` | **PASS** (matrix + 1 Playwright test) |
| Console integration (`m20-6-builder-acceptance.integration.test.ts`) | **PASS** (5/5) |
| Live OpenAI / Gemini | **NOT_RUN** |

### Six-scenario matrix (deterministic fake OpenAI)

`scenarioCount`: 6, `allScenariosExecuted`: true, `liveProviderCalls`: false, `openAiRequestCount`: 10, `provider`: fake-openai.

| Scenario | Status | Structural | Intent | Refinement | Publication | Usage measured | Gen latency (ms) | Provider attempts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| simple | PASS | 2 | 2 | — | 2 | yes (120/15) | ~106 | 1 |
| sequential | PASS | 2 | 2 | — | 2 | yes (120/15) | ~76 | 1 |
| parallel | PASS | 2 | 2 | — | 2 | yes (120/15) | ~78 | 1 |
| approval | PASS | 2 | 2 | — | 2 | yes (120/15) | ~296 | 1 |
| wait-event | PASS | 2 | 2 | — | 2 | yes (120/15) | ~114 | 1 |
| conversational-refinement | PASS | 2 | 2 | 2 | 2 | yes (120/15) | ~160 | 1 |

Scores and latencies are from the latest `artifacts/m20-6/acceptance-results.json` after the browser run (`executionTimestamp` in that file).

### Safety / isolation (same integration suite)

| Case | Result |
| --- | --- |
| Stale base proposal digest | **422** `STALE_BASE_PROPOSAL_DIGEST`, no extra provider call |
| Workspace A generate with workspace B `ModelProfileVersion` | **422** `UNAUTHORIZED_GENERATION_MODEL`, no B resource id in body, no provider call |
| Workspace A refine with B generation model | **422** `UNAUTHORIZED_GENERATION_MODEL`, no provider call |
| VIEWER refine | **403**, EXECUTE denied |

### Real-stack browser (Playwright)

- **1** test: human session, builder UI generate → publish with confirmation, persisted receipt/version IDs, fake provider, no automatic workflow execution.

### Token usage (contract spot-check)

- Optional `usage` on `GenerateCompletionResult`; builder metadata `measuredUsage` aggregates repair attempts via `mergeBuilderModelUsage`.
- Fake OpenAI returns deterministic token units; matrix scenarios record `usageMeasured: true`.
- Missing usage leaves `usageMeasured` false / field absent (not treated as zero cost).
- Focused regressions: `packages/model-gateway/test/model-gateway.test.ts` (passthrough), `packages/domain/test/builder-generation-usage.test.ts` (merge).
- Gemini adapter maps `usageMetadata` when present (`@osva/adapters-model-gemini`); not exercised in M20.6 deterministic matrix.

### Live provider guards (audit only)

- Requires `OSVA_M20_6_LIVE=1` and provider API key (`liveBlockedReason` in `scripts/acceptance/m20-6/lib/live-guards.mjs`).
- Default runner mode remains deterministic fake provider; live matrix not invoked without keys.
- Budget env vars loaded for runner reporting; no billable calls in this acceptance pass.

## Product-readiness (provisional)

| Track | Verdict |
| --- | --- |
| **Engineering acceptance (deterministic + real BFF/browser)** | **GO** on 2026-11-08 evidence above |
| **Live provider acceptance** | **NOT_RUN** |
| **Product readiness (quality/cost/latency on real models)** | **NO-GO** until live samples exist |

Thresholds and rubric: `docs/implementation/M20-6-BUILDER-PRODUCT-ACCEPTANCE.md`.
