# M20.7.3 closeout — Gemini live builder acceptance

Branch: **`feat/m20-7-live-builder-acceptance`**  
Operator live smoke: **2026-11-09T11:46:06.919Z** (`runId` `5eb70b36-0dfc-416d-8c17-f3804843f266`)  
Harness: **`m20-7.2`**

Cross-reference: [`M20_7_ACCEPTANCE_SUMMARY.md`](M20_7_ACCEPTANCE_SUMMARY.md) · [`M20_7_2_CLOSEOUT_SUMMARY.md`](M20_7_2_CLOSEOUT_SUMMARY.md)

## Revision provenance (important)

Artifacts record `sourceCommit` **`ac6efeaf4798d1847f83b3371507e8ecc4c4d942`** (last committed revision on the branch at run time — M20.7.2). The passing Gemini smoke was executed with **M20.7.3 changes present but uncommitted** in the working tree (adapter, base URL normalization, schema projection, diagnostics, probe). Do **not** treat the recorded `sourceCommit` as the code revision that produced the PASS; the closeout commit for M20.7.3 lands after this evidence.

Prior failed Gemini evidence at the same `sourceCommit` (MODEL_PROVIDER_ERROR, no HTTP status) remains valid historical record and is not rewritten.

## 1. Scope and acceptance criteria

M20.7.3 delivers **operator-controlled, billable live smoke** for the same natural-language builder scenarios as M20.7.2, against **real Google Gemini**:

- Two scenarios: **workflow-generation** and **conversational-refinement** (manifest `live-smoke-manifest.json`)
- Provider **`GOOGLE_GEMINI`**, model **`gemini-3.6-flash`**, official Generative Language API
- Provenance: `providerIdentityVerified`, `liveProviderCalls`, `actualProviderCallsObserved`
- Hard budgets including **USD micro cap** before provider HTTP
- **No** publication, **no** workflow execution runs (unchanged M20.7 guards)

**Out of scope:** production SLO claims, multi-tenant matrix, CI billable runs, combined PR merge (deferred).

Supplemental **single-invocation generation probe** (`pnpm acceptance:m20-7:gemini-probe`) for forensics; not a substitute for two-scenario smoke.

## 2. Final verified results (live)

Local artifacts (gitignored): `artifacts/m20-7/acceptance-results.json`, `acceptance-report.md`

| Check | Result |
| --- | --- |
| `overallStatus` | **PASS** |
| `liveProvider` | **gemini** |
| Scenarios | **2/2 PASS** |
| `actualProviderCallsObserved` | **2** |
| `providerIdentityVerified` / `liveProviderCalls` | **true** |
| Builder HTTP | **200 / 200** (integration evidence) |
| CLI exit | **0** |
| `generationFailure` | absent (no failure block in results) |

### Per-scenario (measured)

| Scenario | Structural | Intent | Refinement | Attempts | Input | Output | Latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| workflow-generation | 2 | 2 | — | 1 | 1124 | 1244 | 16632.6 |
| conversational-refinement | 2 | 2 | 2 | 1 | 1458 | 1359 | 47302.3 |

## 3. Provider, model, endpoint

| Item | Value |
| --- | --- |
| Provider | **GOOGLE_GEMINI** |
| Model | **gemini-3.6-flash** |
| Official endpoint (provisioned + normalized) | `https://generativelanguage.googleapis.com/v1beta` |
| Structured output wire field | **`responseJsonSchema`** (+ projected schema) |
| Auth (connection-bound) | Query `key` (credential ref `GOOGLE_GEMINI_API_KEY`); direct operator probes may use header auth — both valid for Google |

## 4. Schema projection decisions

- Builder canonical schema: `BuilderProposalOpenAiJsonSchema` (domain validation unchanged)
- Gemini wire: **`responseJsonSchema`** via `projectJsonSchemaForGeminiResponseJsonSchema`
- **`const`** (strings) → single-value **`enum`** on wire only
- **`pattern`** omitted on wire; enforced in domain parser
- Do **not** send full schema as legacy `responseSchema` (OpenAPI subset)

## 5. Canonical validation guarantees

- Proposal parse, catalog visibility, and pre-publication compile remain domain-authoritative
- Provider JSON schema is a **transport hint** only; no relaxation of OSVA invariants for Gemini

## 6. Base URL normalization fix

Connection versions historically stored host root without `/v1beta`. Adapter now **`normalizeGeminiProviderBaseUrl`** so `generateContent` targets `/v1beta/models/{model}:generateContent`. This resolved live **`MODEL_NOT_FOUND` / HTTP 404** when the path omitted the API version.

Provisioner and routing constants updated to **`…/v1beta`** for new live bindings.

## 7. Provider diagnostics improvements

- HTTP status preserved when response body parse fails (`text()` + safe JSON parse)
- **`providerTransportErrorCategory`** for pre-response / adapter failures
- Builder diagnostics: **`google-gemini`** token → `GOOGLE_GEMINI`
- Gemini HTTP errors surface **`providerErrorType`** from Google `error.status` when present

## 8. Cost and usage safeguards

| Item | Value |
| --- | --- |
| `pricingVersion` | `m20-7.3-2026-11-09` |
| `pricingRateSource` | `google-gemini-3.6-flash-introductory-paid-nov-2026` |
| Budget cap (configured) | **250000 micro-USD** ($0.25) |
| Measured usage | **yes** on both scenarios |

### Estimated actual spend (harness rates, not Google invoice)

| Scenario | Input µUSD | Output µUSD | Subtotal µUSD |
| --- | ---: | ---: | ---: |
| workflow-generation | 843 | 4665 | 5508 |
| conversational-refinement | 1094 | 5097 | 6191 |
| **Total** | **1937** | **9762** | **~11699** (~**$0.0117**) |

Rates: `scripts/acceptance/m20-7/lib/pricing.mjs` (750k / 3.75M micro-USD per 1M input/output tokens for `gemini-3.6-flash`).

## 9. Single-invocation probe

- Entry: `pnpm acceptance:m20-7:gemini-probe` (dry-run) / `--execute` (one generation, billable gates)
- Artifact: `artifacts/m20-7/gemini-generation-probe.json` (separate from acceptance-results)
- Worst-case preflight estimate at 8192/2048 tokens: **13824 micro-USD**
- Execute exit **nonzero** unless `BUILDER_GENERATION_PASS`
- Web cap: `OSVA_BUILDER_GENERATION_MAX_PROVIDER_INVOCATIONS=1` for probe

## 10. Previous failures and resolutions

| Failure | Cause | Resolution |
| --- | --- | --- |
| Gemini smoke ERROR, `MODEL_PROVIDER_ERROR`, no HTTP status | Legacy **`responseSchema`** + swallowed transport errors | **`responseJsonSchema`** + projection; diagnostics hardening |
| `MODEL_NOT_FOUND` / 404 with HTTP observed | Base URL without **`/v1beta`** | **`normalizeGeminiProviderBaseUrl`** + official URL fix |
| Probe cost `estimatedMicroUsd: null` | Wrong args to `worstCaseAttemptCostMicroUsd` | Token bounds object + validation |
| Probe CLI exit 0 on provider error | Vitest pass despite failure outcome | Artifact outcome gate |

## 11. Remaining limitations

- One successful **two-scenario smoke** does not prove builder reliability across prompts, models, or tenants
- Harness scoring is rubric/heuristic, not LLM-as-judge
- Gemini pricing is operator-declared conservative; invoice may differ
- Isolated generation probe artifact may be absent if only full smoke was run
- Billable tests remain **operator-only**; CI must not set billable flags

## 12. Regression verification (closeout session — no billable)

Recorded at M20.7.3 closeout commit preparation (see commit message). No Gemini/OpenAI live rerun during closeout.

| Check | Result |
| --- | --- |
| `node --test scripts/acceptance/m20-7/test/*.test.mjs` | **31/31 PASS** |
| `@osva/adapters-model-gemini` tests | **25/25 PASS** |
| `@osva/console` M20.7 probe unit tests | **12/12 PASS** |
| `@osva/domain` builder-model-gateway-diagnostics | **4/4 PASS** |
| `@osva/web` builder-generation-limits | **2/2 PASS** |
| Billable Gemini/OpenAI live rerun | **not run** (closeout) |
| `m20-7-builder-regression.integration.test.ts` (Docker) | **deferred** |
| `pnpm verify:ci:clean` | **deferred** |

## Readiness for combined M20.7 PR

M20.7.1 + M20.7.2 + M20.7.3 evidence supports a **single reviewable PR** on `feat/m20-7-live-builder-acceptance` after operator pushes. Product **live readiness** remains **scoped** to documented smoke — not broad production certification.
