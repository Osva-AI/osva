# M20.7 acceptance summary

**Branch:** `feat/m20-7-live-builder-acceptance`
**Harness:** `m20-7.2` (M20.7.1 guards + M20.7.2 live smoke scenarios)
**Baseline:** `origin/main` (M20.6 merged)

## M20.7.2 engineering acceptance

| Verdict | Value |
|---------|--------|
| **M20.7.2 harness readiness** | **COMPLETE (scoped)** — see [`M20_7_2_CLOSEOUT_SUMMARY.md`](M20_7_2_CLOSEOUT_SUMMARY.md) |
| **M20.7.1 guards** | **PASS** (committed `e054544`) |
| **Live OpenAI smoke** | **PASS** (2026-11-08; harness `m20-7.2`; 2/2 scenarios; provenance verified) |
| **M20.7.3 harness + Gemini** | **COMPLETE (scoped)** — [`M20_7_3_CLOSEOUT_SUMMARY.md`](M20_7_3_CLOSEOUT_SUMMARY.md) |
| **Live Gemini smoke** | **PASS** (2026-11-09; 2/2 scenarios; `gemini-3.6-flash`; provenance verified) |
| **Product readiness** | **NO-GO for broad live claims** — two provider smokes only; wider matrix deferred |

### Phase 1 audit (M20.7.1 baseline)

| Check | Status |
|-------|--------|
| M20.7.1 committed | **yes** (`e054544`) |
| Working tree before M20.7.2 edits | **clean** |
| Fake-provider fallback blocked | **yes** (`live-ready` stack has no fake listener; loopback endpoints rejected) |
| Official OpenAI routing | **yes** (`https://api.openai.com/v1` via `provisionM20_7LiveModelProfiles`) |
| Provenance requires invocation | **yes** (`deriveLiveProviderCallsFlag` fail-closed) |
| Hard budgets before provider calls | **yes** (`budgets.mjs` reservation + integration `m20-7-live-eval.ts`) |
| Ordinary tests cannot spend money | **yes** (`OSVA_M20_7_ALLOW_BILLABLE` + `it.skipIf` on smoke) |
| M20.6 deterministic preserved | **yes** (`pnpm acceptance:m20-6` unchanged; deprecated `OSVA_M20_6_LIVE` errors) |

**Live execution entrypoint:** `pnpm acceptance:m20-7:live -- --provider=openai --smoke` → `scripts/acceptance/m20-7/run.mjs` → Vitest `m20-7-builder-live.integration.test.ts` (billable path only when `OSVA_M20_7_ALLOW_BILLABLE=1`).

### Live smoke scenarios (natural language)

Manifest: `scripts/acceptance/m20-7/scenarios/live-smoke-manifest.json`

| ID | Operation | Prompt summary |
|----|-----------|----------------|
| `workflow-generation` | generate | Weekly product feedback summarization; themes, critical issues, recommendations; no external tools |
| `conversational-refinement` | refine | Add fact-checking agent after summarizer; preserve summarizer instructions |

No `OSVA_M20_6_SCENARIO` markers. Exactly **two** builder operations in smoke mode.

## Non-billable verification (M20.7.2 closeout session)

| Check | Result |
|-------|--------|
| `pnpm acceptance:m20-7:test` | 16/16 PASS |
| `pnpm acceptance:m20-7:regression` | 6/6 PASS |
| `pnpm acceptance:m20-7:preflight -- --provider=openai --smoke` | PASS |
| `pnpm acceptance:m20-6:test` | 5/5 PASS |
| `pnpm acceptance:m20-6:smoke` | 5/5 PASS |
| `@osva/console` lint | PASS |
| `@osva/console` typecheck | PASS |
| Prettier (M20.7 touched files) | PASS |
| `git diff --check` | PASS |
| Billable live smoke | **NOT_RUN** |

## Operator live smoke (OpenAI — recorded 2026-11-08)

Evidence commit: `e054544fe94db2230711550e6c1838bc063e1bb5` · run id `409b2647-ee13-4464-b831-fa3ed6229274`

| Check | Result |
|-------|--------|
| `overallStatus` | **PASS** |
| Scenarios | `workflow-generation` **PASS**, `conversational-refinement` **PASS** |
| `actualProviderCallsObserved` | **2** |
| `providerIdentityVerified` / `liveProviderCalls` | **true** |
| `generationFailure` | **null** |
| CLI exit | **0** |
| Measured tokens (in / out) | 3976 / 668 |
| Estimated spend (`gpt-4o-mini`, conservative rates) | **~998 micro-USD** (~$0.001) vs **$0.50 cap** |
| Publication / workflow runs | **not exercised** (run count unchanged) |

## Operator live smoke (Gemini — recorded 2026-11-09)

Evidence `sourceCommit` in artifact: **`ac6efeaf`** (HEAD at flush time). **PASS was produced with uncommitted M20.7.3 code** — see [`M20_7_3_CLOSEOUT_SUMMARY.md`](M20_7_3_CLOSEOUT_SUMMARY.md) §Revision provenance. Run id `5eb70b36-0dfc-416d-8c17-f3804843f266`.

| Check | Result |
|-------|--------|
| `overallStatus` | **PASS** |
| Scenarios | `workflow-generation` **PASS**, `conversational-refinement` **PASS** |
| `actualProviderCallsObserved` | **2** |
| Model | `gemini-3.6-flash` |
| Measured tokens (in / out) | 2582 / 2603 (scenario totals) |
| Estimated spend (harness rates) | **~11699 micro-USD** (~$0.012) vs **$0.25 cap** |
| Latency (ms) | 16633 / 47302 |
| CLI exit | **0** |

Gemini probe (optional): `pnpm acceptance:m20-7:gemini-probe` → `gemini-generation-probe.json`.

```powershell
$env:OSVA_M20_7_LIVE_PROVIDER = "gemini"
$env:GOOGLE_GEMINI_API_KEY = "<from-secret-store>"
$env:OSVA_M20_7_MAX_COST_USD_MICROS = "250000"
pnpm acceptance:m20-7:live -- --provider=gemini --smoke
```

## Commands (CI-safe — run before operator smoke)

```powershell
pnpm acceptance:m20-7:test
pnpm acceptance:m20-7:regression
pnpm acceptance:m20-7:preflight -- --provider=openai --smoke
pnpm acceptance:m20-6:test
pnpm acceptance:m20-6:smoke
```

## Operator live smoke (billable — human only)

```powershell
$env:OSVA_M20_7_LIVE = "1"
$env:OSVA_M20_7_ISOLATED = "1"
$env:OSVA_M20_7_LIVE_EXECUTE = "1"
$env:OSVA_M20_7_ALLOW_BILLABLE = "1"
$env:OSVA_M20_7_SMOKE = "1"
$env:OSVA_M20_7_MAX_COST_USD_MICROS = "500000"   # 0.50 USD cap (micro-USD)
$env:OSVA_M20_7_GENERATION_MODEL = "gpt-4o-mini"  # or operator-authorized model
$env:OSVA_M20_7_EXECUTION_MODEL = "gpt-4o-mini"
$env:OPENAI_API_KEY = "<from-secret-store>"

pnpm acceptance:m20-7:preflight -- --provider=openai --smoke
pnpm acceptance:m20-7:live -- --provider=openai --smoke
```

### Configured smoke budget (defaults when env unset)

| Limit | Smoke live default |
|-------|-------------------|
| Builder requests | 2 |
| Provider invocations | 4 (includes repair attempts) |
| Max output tokens / attempt | 2048 |
| Max input tokens / attempt | 8192 |
| Total elapsed | 180s |
| Repair attempts | 2 |
| USD cap | **required** (`OSVA_M20_7_MAX_COST_USD_MICROS`) |

**Maximum possible provider HTTP attempts:** 4 (2 operations × up to 2 invocations each with repair).
**Pricing:** `scripts/acceptance/m20-7/lib/pricing.mjs` (`MODEL_PRICING_VERSION=m20-7.2-2026-11-08`).

### Evidence paths (gitignored)

- `artifacts/m20-7/acceptance-results.json`
- `artifacts/m20-7/acceptance-report.md`

Verify: `actualProviderCallsObserved > 0`, `providerIdentityVerified: true`, `liveProviderCalls: true` before claiming live PASS.

### Abort safely

- Ctrl+C during Vitest or Docker preflight.
- Harness `afterAll` stops disposable Postgres/Valkey containers.
- Removing `OSVA_M20_7_ALLOW_BILLABLE` blocks billable calls on the next run.

## Failure diagnosis

| Symptom | Likely cause |
|---------|----------------|
| `CI_LIVE_BLOCKED` | Live in CI without `OSVA_M20_7_ALLOW_CI_LIVE=1` |
| `OSVA_M20_7_ALLOW_BILLABLE not set` | Expected for non-operator runs |
| `BILLABLE_CALLS_DISABLED` | Preflight integration without billable flags |
| `UNKNOWN_MODEL_PRICING` | Set model in `pricing.mjs` or choose a listed default |
| `LIVE_PASS_WITHOUT_VERIFIED_PROVIDER_PROVENANCE` | Claims PASS without observed adapter calls |
| `INTENT_MISMATCH` / `PARTIAL` | Model quality — inspect rubric scores in artifacts |

## Confirmed M20.6 live gaps (historical)

1. Fake provider routing on legacy `OSVA_M20_6_LIVE`.
2. Unverified `liveProviderCalls` from env alone.
3. Soft post-hoc budgets only.

## Cleanup

Delete local `artifacts/m20-7/` when rotating evidence; files are gitignored.
