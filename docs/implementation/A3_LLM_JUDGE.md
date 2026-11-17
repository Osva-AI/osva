# A3 — LLM-as-Judge, immutable rubrics, durable judge execution

## Summary

A3 adds the `LLM_JUDGE` evaluator type with immutable rubric identity, workspace-scoped judge `ModelProfileVersion` bindings, strict JSON verdict validation, and durable `evaluation_judge_tasks` execution recovered on the worker via `EvaluationRecoveryTick`.

## Architecture decision

**Option B (chosen):** narrowly scoped `evaluation_judge_tasks` with PostgreSQL lease/fencing, processed by `ProcessEvaluationJudgeTasks` on the existing worker recovery loop — not inline in child-run reconciliation and not a second queue deployment.

## Lifecycle

1. Child run reaches a terminal `SUCCEEDED` state.
2. `ReconcileEvaluationCase` creates or reuses a judge task; no case result yet.
3. `ProcessEvaluationJudgeTasks` claims the task, calls `ModelGateway` with a versioned prompt and JSON schema.
4. OSVA validates the verdict, derives pass/fail from `minPassingScore`, and persists `EvaluationCaseResult`.
5. Parent `EvaluationRun` finalization waits until case results exist and no non-terminal judge tasks remain.

## Error semantics

Malformed or missing judge output yields evaluator **ERROR**, not FAIL or score zero.

## Deferred (A4/A5)

RAG judges, pairwise comparison, and human calibration are not implemented in A3.