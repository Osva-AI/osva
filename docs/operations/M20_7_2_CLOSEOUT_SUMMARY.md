# M20.7.2 closeout — OpenAI live builder acceptance

Branch: **`feat/m20-7-live-builder-acceptance`**  
Evidence commit (integration run): **`e054544fe94db2230711550e6c1838bc063e1bb5`**  
Harness: **`m20-7.2`**  
Operator live smoke: **2026-11-08T19:59:02.351Z** (`runId` `409b2647-ee13-4464-b831-fa3ed6229274`)

Cross-reference: [`M20_7_ACCEPTANCE_SUMMARY.md`](M20_7_ACCEPTANCE_SUMMARY.md) · implementation spec [`../implementation/M20-7-LIVE-BUILDER-VALIDATION.md`](../implementation/M20-7-LIVE-BUILDER-VALIDATION.md)

## 1. Scope

M20.7.2 delivers **operator-controlled, billable live smoke** for the natural-language workflow builder against **real OpenAI**, with:

- Natural-language prompts only (no `OSVA_M20_6_SCENARIO` fixture markers)
- Two scenarios: **workflow generation** and **conversational refinement**
- Evidence-backed structural, intent, and refinement rubrics
- Hard budgets (requests, invocations, tokens, duration, **USD cap**) before provider HTTP
- Fail-closed live provenance (`actualProviderCallsObserved`, `providerIdentityVerified`)

**Out of scope for this slice:** publication to workspace catalog, workflow execution runs, Gemini live smoke (M20.7.3), combined PR merge.

## 2. OpenAI model and API surface

| Item | Value |
| --- | --- |
| Provider | OpenAI (`liveProvider: openai`) |
| Official endpoint | `https://api.openai.com/v1` |
| Default generation model | `gpt-4o-mini` (`OSVA_M20_7_GENERATION_MODEL`) |
| Default execution model | `gpt-4o-mini` (`OSVA_M20_7_EXECUTION_MODEL`) |
| Builder path | Console builder natural-language generate/refine → ModelGateway → OpenAI provider adapter |
| Structured output | Builder proposal JSON schema (strict OpenAI JSON schema variant + compile-time topology guidance) |

Identity verified in acceptance artifacts: `providerIdentityVerified: true`, `actualProviderCallsObserved: 2`.

## 3. Acceptance scenarios

Manifest: `scripts/acceptance/m20-7/scenarios/live-smoke-manifest.json`

| ID | Operation | Intent |
| --- | --- | --- |
| `workflow-generation` | generate | Weekly feedback summarization; themes, critical issues, recommendations; no external tools |
| `conversational-refinement` | refine | Add fact-checking agent after summarizer; preserve summarizer instructions |

## 4. Verification results (live)

Local artifacts (gitignored): `artifacts/m20-7/acceptance-results.json`, `acceptance-report.md`

| Check | Result |
| --- | --- |
| `overallStatus` | **PASS** |
| `scenarioCount` | **2** (both **PASS**) |
| `generationFailure` | **null** |
| `liveProviderCalls` | **true** |
| `providerIdentityVerified` | **true** |
| `actualProviderCallsObserved` | **2** |
| CLI / Vitest exit | **0** (harness fail-closed on PASS without provenance) |
| Workflow runs created | **none** (`countWorkflowRuns` unchanged post-smoke) |
| Publication | **not exercised** (generate/refine only) |

### Per-scenario scores (measured usage)

| Scenario | Structural | Intent | Refinement | Attempts | Input tok. | Output tok. | Latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| workflow-generation | 2 | 2 | — | 1 | 1857 | 237 | 8100.32 |
| conversational-refinement | 2 | 2 | 2 | 1 | 2119 | 431 | 6712.77 |

## 5. Token usage and estimated cost

**Measured totals (both scenarios):** 3976 input units, 668 output units.

**Configured budget cap (not spend):** `maxEstimatedCostUsdMicros: 500000` (**$0.50** operator ceiling via `OSVA_M20_7_MAX_COST_USD_MICROS`).

**Estimated actual spend** (operator-declared conservative rates, `pricingVersion` `m20-7.2-2026-11-08`, model `gpt-4o-mini`):

| Component | Calculation | Micro-USD |
| --- | --- | --- |
| Input | 3976 × $0.15 / 1M | 597 |
| Output | 668 × $0.60 / 1M | 401 |
| **Total** | | **~998** (~**$0.0010**) |

Rates: `scripts/acceptance/m20-7/lib/pricing.mjs` (aligned with `estimateUsageCostMicroUsd` in `m20-7-live-eval.ts`). This is a **harness estimate** from reported token usage, not an OpenAI invoice.

## 6. Refinement semantics (evidence)

Live refinement scenario **PASS** with refinement rubric score **2** indicates (per `scoreLiveRefinement` in `m20-7-live-eval.ts`):

- At least one new agent added (`minAddedAgents`)
- Summarizer instructions unchanged vs. generation base (`preserveSummarizerInstructions`)
- Fact-check semantics in a newly added agent (regex on instructions / agent role)
- Summarizer precedes fact-checker in workflow execution order (edge topology)
- Proposal compiles without blocking issues (structural score uses `compileBuilderProposalPrePublication`)

### Rubric limitations

Scoring is **heuristic, not semantic understanding**:

- No LLM-as-judge; intent uses keyword hints (e.g. summarization themes)
- Fact-checking is inferred from instruction text patterns, not output quality
- A single successful smoke does **not** prove builder reliability across models, prompts, or tenants
- `PARTIAL` / `requiresHumanReview` paths exist for ambiguous rubric hits — this run had none

## 7. Engineering changes in M20.7.2 (this branch)

| Area | Change |
| --- | --- |
| **OpenAI JSON schema** | Strict schema module, pointer guidance, branch/topology hardening |
| **Generation/refinement** | Attempt diagnostics, model-gateway diagnostic surfacing, prompt/schema pipeline fixes |
| **OpenAI adapter** | Resolved max retries export; richer gateway error options |
| **Connectivity** | Connection resolver adjustments + tests |
| **Contracts** | JSON pointer helper fixes |
| **Acceptance harness** | Live smoke manifest, intent/refinement scoring, acceptance status gating, schema probe, pricing/budget alignment |
| **Domain tests** | NL generation failure evidence, topology/schema/diagnostic unit coverage |

## 8. Diagnostic and acceptance-gating improvements

- Fail-closed `deriveLiveProviderCallsFlag` and report consistency (`scripts/acceptance/m20-7/lib/report.mjs`)
- `liveAcceptanceShouldExitNonZero` ties CLI exit to overall status
- Builder generation failure evidence sanitized for artifacts (no raw provider payloads)
- Preflight vs. live execute separation; billable gate `OSVA_M20_7_ALLOW_BILLABLE`

## 9. Remaining limitations

- **One OpenAI model, two prompts, one run** — smoke only
- M20.6 six-scenario matrix remains deterministic fake-provider; not replaced by live smoke
- Gemini live path **not** validated (M20.7.3)
- Rubric scores ≠ product quality guarantees
- `pnpm verify:ci:clean` **not** re-run for this closeout (focused gates below)

## 10. Deferred scope

- M20.7.3 **Gemini** live smoke on same branch before combined PR
- Broader live scenario matrix (parallel, approval, wait) under cost controls
- Invoice-level cost reconciliation vs. harness estimates
- Tracker / roadmap entry for full M20.x product line (beyond M20.7)

## 11. M20.7.3 handoff

**Next:** Operator billable smoke with `--provider=gemini`, same harness version family, `GOOGLE_GEMINI_API_KEY`, official Gemini endpoint provisioning (`provisionM20_7LiveModelProfiles` gemini branch). Reuse budgets and provenance rules from M20.7.1. Do not merge M20.7.1+7.2 PR until M20.7.3 evidence is recorded or explicitly deferred by operator.

## 12. Closeout verification (engineering, 2026-11-09)

| Gate | Result |
| --- | --- |
| `pnpm acceptance:m20-7:test` | **PASS** (19/19) |
| `pnpm acceptance:m20-7:regression` | **PASS** (9/9 integration) |
| `@osva/console` lint | **PASS** |
| `@osva/console` typecheck | **PASS** |
| `@osva/domain` builder NL/schema/topology tests | **PASS** (69) |
| `@osva/console` m20-7 eval/scoring tests | **PASS** (15) |
| `@osva-ai/contracts` json-pointer tests | **PASS** |
| `@osva/adapters-model-openai` adapter tests | **PASS** |
| `git diff --check` | **PASS** (at commit) |
| Staged secrets / raw provider bodies | **none** |

**M20.7.2 milestone status:** **Complete (scoped)** — single verified OpenAI live smoke PASS; not a general live reliability certification.
