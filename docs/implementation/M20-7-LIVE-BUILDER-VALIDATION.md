# M20.7 Live builder validation

Milestone **M20.7.1** corrects M20.6 “live” gaps; **M20.7.2** adds natural-language live smoke scenarios and quality evaluation (operator-executed). the legacy `OSVA_M20_6_LIVE=1` path still started `startM12_3HumanConsoleStack()` with `ModelProviderConnectionVersions` pointed at `stack.fakeOpenAI.origin`, skipped the deterministic matrix, and set `liveProviderCalls` from configuration instead of verified adapter provenance.

## Architecture

| Layer | Deterministic (M20.6) | Live-ready (M20.7) |
|--------|------------------------|---------------------|
| Stack | `startM12_3HumanConsoleStack` / M20.7 `deterministic` profile | `startM20_7HumanConsoleStack({ profile: "live-ready" })` |
| Provider listener | Fake OpenAI HTTP server | **No** fake OpenAI listener |
| Connection `baseUrl` | Loopback fake origin + `allowPrivateNetworks` | Official provider URL only |
| Model IDs | Fixture ids (`gpt-m20-6-*`) | Configurable real ids (`OSVA_M20_7_GENERATION_MODEL`, …) |
| Billable calls | Fake server only | Gated: `OSVA_M20_7_LIVE_EXECUTE=1` **and** `OSVA_M20_7_ALLOW_BILLABLE=1` |
| Provenance | `liveProviderCalls: false` + fake request counts | `actualProviderCallsObserved` + `providerIdentityVerified` |

## Operator commands

```powershell
# CI-safe deterministic matrix (unchanged)
pnpm acceptance:m20-6:smoke

# M20.7 guard/regression (no providers)
pnpm acceptance:m20-7:test
pnpm acceptance:m20-7:regression

# Dry-run / preflight (no provider HTTP)
$env:OSVA_M20_7_LIVE = "1"
$env:OSVA_M20_7_ISOLATED = "1"
$env:OSVA_M20_7_MAX_COST_USD_MICROS = "500000"
$env:OPENAI_API_KEY = "<from-secret-store>"
pnpm acceptance:m20-7:preflight -- --provider=openai --smoke

# Live execute (billable — not run during M20.7.1 implementation)
$env:OSVA_M20_7_LIVE_EXECUTE = "1"
$env:OSVA_M20_7_ALLOW_BILLABLE = "1"
pnpm acceptance:m20-7:live -- --provider=openai --smoke
```

## Budgets and pricing

Hard caps load from `OSVA_M20_7_*` env vars (`scripts/acceptance/m20-7/lib/budgets.mjs`). Live mode requires `OSVA_M20_7_MAX_COST_USD_MICROS`. Pre-request reservation uses conservative per-model pricing (`lib/pricing.mjs`, version `m20-7.2-2026-11-08`). Unknown models block when a USD cap is required.

Live smoke manifest (NL prompts, no fixture markers): `scripts/acceptance/m20-7/scenarios/live-smoke-manifest.json`. Integration scoring: `apps/console/test/integration/m20-7-live-eval.ts`.

## Evidence

Artifacts: `artifacts/m20-7/acceptance-results.json` (gitignored). Each run gets a unique `runId`. Live `PASS` requires verified provenance (`lib/report.mjs` fail-closed).

## Quality scoring

Deterministic structural scoring remains in M20.6 integration tests. Live intent rubric: `scripts/acceptance/m20-7/lib/intent-scoring.mjs` (no mandatory LLM judge; semantic gaps → `requiresHumanReview` / score `1`).

## Security

- Live provisioning rejects loopback/fake endpoints (`m20-7-builder-helpers.ts`, `lib/provider-routing.mjs`).
- Sentinel OpenAI key rejected in live-ready stack.
- Reports redact secrets via shared M20.6 redaction patterns.

## Status

| Slice | Status |
| --- | --- |
| M20.7.1 live-ready guards | **Complete** (committed `e054544`) |
| M20.7.2 OpenAI live smoke | **Complete (scoped)** — operator PASS 2026-11-08; [`../operations/M20_7_2_CLOSEOUT_SUMMARY.md`](../operations/M20_7_2_CLOSEOUT_SUMMARY.md) |
| M20.7.3 Gemini live smoke | **Complete (scoped)** — operator PASS 2026-11-09; [`../operations/M20_7_3_CLOSEOUT_SUMMARY.md`](../operations/M20_7_3_CLOSEOUT_SUMMARY.md) |
| M20.7.4 Anthropic probes | **FUNCTIONAL_ACCEPTANCE_COMPLETE (scoped)** — not RELEASE_VERIFICATION_COMPLETE; [`../operations/M20_7_4_CLOSEOUT_SUMMARY.md`](../operations/M20_7_4_CLOSEOUT_SUMMARY.md) |

Gemini isolated generation probe: `pnpm acceptance:m20-7:gemini-probe` (see closeout §9).

Anthropic isolated generation probe (SDK path): `pnpm acceptance:m20-7:anthropic-probe`.

Anthropic isolated conversational refinement probe (canonical fixture baseline, one refine call, no generation rerun):

```powershell
# Dry-run (zero provider I/O)
pnpm acceptance:m20-7:anthropic-refinement-probe

# Operator billable execute — one POST /v1/builder/proposals/refine, no retries/repair
$env:OSVA_M20_7_LIVE = "1"
$env:OSVA_M20_7_ISOLATED = "1"
$env:OSVA_M20_7_LIVE_EXECUTE = "1"
$env:OSVA_M20_7_ALLOW_BILLABLE = "1"
$env:OSVA_M20_7_MAX_COST_USD_MICROS = "250000"
$env:ANTHROPIC_API_KEY = "<from-secret-store>"
pnpm acceptance:m20-7:anthropic-refinement-probe -- --execute
```

Model is `claude-sonnet-5-5`. Worst-case estimate is 36864 micro-USD (8192 input / 2048 output tokens). A JSON HTTP 200 is not a pass: the probe scores APPROVAL-before-final-AGENT insertion, identity preservation, catalog/compiler validation, and `maxProviderInvocations=1`. Artifact: `artifacts/m20-7/anthropic-refinement-probe.json` (does not overwrite the generation probe artifact). `sourceCommit` does not identify uncommitted M20.7.4 working-tree changes.

Anthropic raw Messages diagnostic (SDK bypass, full Builder schema, default dry-run):

```powershell
# Dry-run (zero provider I/O)
pnpm acceptance:m20-7:anthropic-raw-messages

# Operator billable execute — one POST /v1/messages, no retries
$env:OSVA_M20_7_LIVE = "1"
$env:OSVA_M20_7_ISOLATED = "1"
$env:OSVA_M20_7_LIVE_EXECUTE = "1"
$env:OSVA_M20_7_ALLOW_BILLABLE = "1"
$env:OSVA_M20_7_MAX_COST_USD_MICROS = "250000"
$env:ANTHROPIC_API_KEY = "<from-secret-store>"
$env:ANTHROPIC_WORKSPACE_ID = "<wrkspc_... if identity-linked>"
$env:OSVA_M20_7_ANTHROPIC_SHOW_PROVIDER_ERROR_TEXT = "1"
pnpm acceptance:m20-7:anthropic-raw-messages -- --execute
```

HTTP 200 on the raw path means Anthropic accepted the **flat records** Builder IR (`anthropic_records_v1`) over raw `fetch`; it does **not** prove Builder proposal validation. HTTP 400 classified codes go to stdout; raw `error.message` is local stderr only after the display opt-in and safety checks. Canonical `parseBuilderProposalV1` / compiler validation still run after decode. Canonical and typed-array compact envelopes were rejected with `compiled_grammar_too_large`.

One successful smoke per provider does not certify builder quality across models or prompts.
