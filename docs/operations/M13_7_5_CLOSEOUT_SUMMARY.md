# M13.7.5 Closeout Summary — Scoring & Safety Gates

**Milestone slice:** M13.7.5 (Slices A–D) on **`main`** after merge of `feat(evaluation): add scoring and quality gates (M13.7.5)`.

Evidence checklist: [`M13_7_5_ACCEPTANCE_SUMMARY.md`](M13_7_5_ACCEPTANCE_SUMMARY.md).

## Delivered capabilities

| Slice | What shipped |
| --- | --- |
| **A — Scoring** | Deterministic `EvaluationRunSummary` derived from immutable case results: pass rate, completion coverage, PASS/FAIL/ERROR counts, and mean normalized **quality score** (PASS=1, FAIL=0; ERROR excluded). Duplicate case reconciliation is stable and rejects inconsistent outcomes. |
| **B — Usage / cost** | Aggregates succeeded (and partially failed) MODEL RunStep usage across all child RunAttempts for an evaluation run: input/output tokens, priced cost subtotal (USD micros), unpriced model call count, optional duration from case completion timestamps, and `usageMeasured` when no child usage exists. |
| **C — Quality gate** | Optional `EvaluationQualityGatePolicyV1` on `POST /v1/evaluation-runs` (one rule per metric, MIN/MAX thresholds). Terminal runs persist a single immutable `EvaluationRunGateAssessment` (policy snapshot + assessment JSON). Non-terminal reads return preview assessments that **never** surface unpersisted overall **PASS**. Verdicts: **PASS**, **FAIL**, **INDETERMINATE** (missing evidence, incomplete pricing, incomplete lifecycle). |
| **D — API & Console** | Evaluation run detail includes `summary` and optional `qualityGate`. Console launch flow edits gate rules; run detail renders verdict, lifecycle, per-rule results, and usage summary fields. |

## Architecture and persistence boundaries

- **Coordinator unchanged:** Evaluation runs still coordinate ordinary child Runs; no evaluation worker type ([`evaluation-run.md`](../architecture/flows/evaluation-run.md) flow remains valid at the orchestration level).
- **PostgreSQL authority:** Case results and gate assessments are persisted in Postgres; BullMQ remains transport only.
- **Domain assessment:** Pure functions in `@osva/domain` (`aggregateEvaluationRunSummary`, `assessEvaluationQualityGate`, `resolveEvaluationRunQualityGate`) — no provider SDK types in contracts.
- **Immutability:** Terminal gate assessments are insert-once; conflicting re-assessment raises `EvaluationGateAssessmentConflictError`.
- **Policy storage:** Launch-time policy copied to `evaluation_runs.quality_gate_policy`; terminal assessment stores the same policy snapshot for audit.

### Migration head

Repository upgrade target for this slice: **`0029_evaluation_quality_gate_slice`**.

| Object | Purpose |
| --- | --- |
| `evaluation_runs.quality_gate_policy` | Optional JSONB policy chosen at launch |
| `evaluation_run_gate_assessments` | One row per gated terminal run (FK to `evaluation_runs.id`) |

Verify: `pnpm db:migrations:verify` (included in `pnpm verify:ci:clean`).

## Compatibility considerations

- **Additive API:** `qualityGatePolicy` on create and `summary` / `qualityGate` on evaluation-run reads extend existing resources; runs without a policy omit `qualityGate`.
- **Existing suites:** Evaluation suites and cases unchanged; scoring uses existing PASS/FAIL/ERROR outcomes from JSON-style evaluators.
- **Memory adapters:** In-memory evaluation/run repositories updated for parity with Postgres (tests and local fakes).

## Verification and acceptance summary

| Step | Result |
| --- | --- |
| `pnpm verify:ci:clean` | **PASS** (mandatory merge gate) |
| Migration head `0029_evaluation_quality_gate_slice` | **PASS** |
| Manual Console PASS/FAIL gate scenarios | **PASS** (see acceptance summary) |
| Manual Console INDETERMINATE scenario | **NOT EXECUTED** |
| INDETERMINATE rule reasons (missing score, duration, incomplete pricing) | **PASS** (domain unit tests) |

Full evidence table: [`M13_7_5_ACCEPTANCE_SUMMARY.md`](M13_7_5_ACCEPTANCE_SUMMARY.md).

## Known limitations and deferred items

**Confirmed behavior (current slice)**

- Quality gates apply to **batch evaluation runs** launched with a policy; there is no separate gate product outside evaluation runs.
- Cost gate **INDETERMINATE** when any unpriced model calls remain, even if priced subtotal is under threshold.
- Overall **PASS** requires terminal **COMPLETED** run status and persisted assessment (or successful persist on first terminal read).
- Quality score undefined when no PASS/FAIL scored cases exist (for example all ERROR or no reconciled results).

**Deferred / not claimed**

- LLM-as-judge evaluators, human review workflows, and regression baselines beyond deterministic JSON-style case outcomes (product scope mentions; not M13.7.5).
- Dedicated Playwright acceptance for M13.7.5 gate UI (M13.7.4 browser suite does not cover gates).
- Manual browser verification of INDETERMINATE presentation.
- REST contract doc refresh for new evaluation-run fields in [`REST_API_V1.md`](../contracts/REST_API_V1.md) (implementation and Zod schemas are authoritative today).
- Architecture flow doc refresh for scoring, usage aggregation, and gate persistence in [`evaluation-run.md`](../architecture/flows/evaluation-run.md).
- Full **M13** milestone closeout (Agent Studio, Knowledge Studio, Workflow Studio, Testing Studio cross-cutting acceptance and operator narrative).

## Key implementation references

| Area | Location |
| --- | --- |
| Contracts | `packages/contracts/src/evaluation-quality-gate.ts`, `packages/contracts/src/schemas/evaluation-quality-gate.ts`, `evaluationRunSummarySchema` in `packages/contracts/src/schemas/evaluation-suite.ts` |
| Scoring | `packages/domain/src/evaluation-run-scoring.ts` |
| Usage | `packages/domain/src/evaluation-run-usage.ts`, `packages/domain/src/evaluation-run-usage-loader.ts` |
| Gate assessment | `packages/domain/src/evaluation-quality-gate-assessment.ts`, `packages/domain/src/evaluation-run-quality-gate.ts`, `packages/domain/src/evaluation-run-gate-assessment.ts` |
| Application wiring | `packages/domain/src/evaluation-run-application.ts` |
| Postgres | `packages/db/src/repositories/postgres-evaluation-suite-repository.ts`, `packages/db/src/schema/evaluation-run-gate-assessments.ts`, `packages/db/src/repositories/postgres-run-repository.ts` (usage aggregation) |
| HTTP | `apps/web/src/evaluation-http.ts` |
| Console | `apps/console/src/client/routes/evaluation-run-launch-page.tsx`, `evaluation-run-detail-page.tsx`, `components/evaluation/evaluation-quality-gate-*.tsx` |

## M13.7.5 checklist

| Gate | Status |
| --- | --- |
| Deterministic scoring (Slice A) | **PASS** |
| Usage/cost aggregation (Slice B) | **PASS** |
| Immutable policy + persisted assessments (Slice C) | **PASS** |
| API + Console integration (Slice D) | **PASS** |
| Migration `0029_evaluation_quality_gate_slice` | **PASS** |
| Documented INDETERMINATE manual Console evidence | **NOT EXECUTED** (automated only) |

**Overall M13.7.5:** **PASS** and ready for operator use within the delivered scope above.

**Overall M13:** **Incomplete** until milestone-level closeout and remaining documentation/acceptance gaps are addressed.
