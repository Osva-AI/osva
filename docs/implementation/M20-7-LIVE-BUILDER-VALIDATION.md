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
| M20.7.3 Gemini live smoke | **NOT_RUN** |

One successful OpenAI smoke does not certify builder quality across models or prompts.
