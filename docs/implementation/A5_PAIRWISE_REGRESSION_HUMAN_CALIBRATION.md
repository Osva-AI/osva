# A5: Pairwise Comparison, Regression Gates, and Human Calibration

## Status

A5 introduces comparison resources, deterministic paired scoring, versioned regression policy, durable **comparison-scoped** pairwise judge tasks (separate from per-run A3 judge tasks), human review revisions, and observational calibration.

**Console:** API-first; no new Testing Studio surfaces in this slice.

## Comparison lifecycle

1. Both `EvaluationRun`s are terminal in the same workspace and share the same immutable `EvaluationSuiteVersion`.
2. `CreateEvaluationComparison` snapshots `EvaluationComparisonPolicyV1` and optional `EvaluationComparisonPairwiseConfigV1`.
3. Deterministic case alignment is by `EvaluationCase.id` (never array position).
4. If pairwise is enabled, durable tasks are scheduled per case (`PRIMARY`, optional `REVERSED` for position-bias mitigation).
5. While pairwise tasks remain non-terminal, reconciliation treats pairwise evidence as **incomplete** (recommendation stays `INDETERMINATE`, status `RUNNING`).
6. When pairwise work is complete, regression assessment and advisory `PROMOTE` / `BLOCK` / `INDETERMINATE` recommendation are persisted.
7. Promotion is **advisory** only — no deploy or agent switch.

## A5.3 end-to-end acceptance

`packages/db/test/integration/evaluation-comparison-e2e-acceptance.integration.test.ts` exercises PROMOTE/BLOCK/INDETERMINATE flows, human review/calibration, reconciliation after terminal pairwise tasks, and migration **0038** supersession index presence. Pairwise lease fencing remains covered in `evaluation-comparison-pairwise-tasks.integration.test.ts`.

## Deterministic deltas

For each aligned case with valid scores on both sides:

`delta = candidateScore - baselineScore`

Aggregates distinguish **mean paired delta** from independent per-run quality means.

Missing scores and `ERROR` outcomes are **incomplete evidence**, not zero scores.

## Pairwise judgment

- Neutral Answer A / Answer B presentation; canonical preference labels refer to baseline vs candidate.
- Strict verdict: `BASELINE_BETTER` | `CANDIDATE_BETTER` | `TIE`.
- Malformed output and provider errors remain task failures (not ties).
- Reuses A3 model authorization, timeouts, leases, invocation accounting patterns via `EvaluationComparisonPairwiseTask`.

## Regression policy

Separate from `EvaluationQualityGatePolicyV1` (single-run gates remain unchanged).

Precedence: **BLOCK** on verified hard regressions → **INDETERMINATE** on incomplete required evidence → **PROMOTE** only when policy satisfied with complete evidence.

## Human review

Append-only revisions keyed by authenticated `reviewerUserId` (never from untrusted body identity). Does not mutate automated judge outputs.

### REST (A5.2)

See [`../contracts/REST_API_V1.md`](../contracts/REST_API_V1.md) § Evaluation comparisons. Summary:

- Machine principals (API key): create, list, read, pairwise, assessment, calibration.
- **Human session only** for `POST /v1/evaluation-comparisons/:comparisonId/human-reviews` (`WRITE` permission, trusted `Origin`).
- Supersession: at most one new revision may reference a given `supersedesRevisionId` (PostgreSQL unique index `evaluation_comparison_human_review_supersedes_unique`, migration `0038`).
- SDK: `evaluationComparisons` resource without human-review submit.

### Audit

Successful human review submission appends `evaluation_comparison.human_review_submitted` when the web process wires `securityAuditEvents` (same mandatory `appendSecurityAuditEvent` semantics as other control-plane mutations).

## Calibration

Agreement statistics between canonical pairwise preferences and human decisions (excluding `UNSURE` from agreement denominator). Reports unavailable when no eligible paired labels exist.

## Persistence

Migration `0037_evaluation_comparison_slice.sql`:

- `evaluation_comparisons`
- `evaluation_comparison_pairwise_tasks` (unique comparison + case + position)
- `evaluation_comparison_human_review_revisions`

Migration `0038_evaluation_comparison_human_review_supersedes.sql`:

- Unique partial index on `supersedes_revision_id` (one correction per superseded revision)

## Known limitations

- Pairwise worker wiring and PostgreSQL repository adapters must be present for production durability (see acceptance checklist).
- No automated judge fine-tuning or rubric rewriting.
- No runtime RAG context re-fetch; comparisons reuse persisted run results only.