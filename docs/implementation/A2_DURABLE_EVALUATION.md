# A2 — Durable evaluation execution and recovery

## Launch materialization

`LaunchEvaluationRun` persists the parent as **`PENDING`**, materializes one child **Run** per case via `materializeEvaluationChildRun`, then transitions the parent to **`RUNNING`** when every case has a child.

Child identity is durable:

- Idempotency key: `evaluation-run:<evaluationRunId>:case:<evaluationCaseId>`
- Postgres uniqueness: `runs_workspace_id_idempotency_key_unique`
- Child runs store `evaluationRunId` and `evaluationCaseId`

Launch replay looks up existing children before insert and validates workspace / evaluation linkage.

## Partial launch recovery

`RecoverEvaluationRuns` (worker `EvaluationRecoveryTick`, chained inside `ExecutionRecoveryTick`) discovers bounded batches of:

- `PENDING` / `RUNNING` parents
- Terminal parents missing persisted quality-gate assessments

Recovery steps per run:

1. `ensureEvaluationLaunchMaterialized` — create only missing children, enqueue `QUEUED` children
2. Reconcile missing terminal child outputs via `ReconcileEvaluationCase`
3. `reconcileParentTerminalState` when every case has a durable result
4. `recoverEvaluationRunQualityGate` when terminal and assessment row is absent

Queue delivery repair for child runs reuses the existing **`repairQueuedDeliveries`** path in `ExecutionRecoveryTick` (evaluation child runs are ordinary runs).

## Case reconciliation idempotency

- `shouldFinalizeEvaluationCaseResult` defers scoring while a child run is **`INTERRUPTED`** with a lease-expiry attempt (recovery may succeed).
- `saveCaseResult` uses Postgres `ON CONFLICT DO NOTHING` on `(evaluation_run_id, evaluation_case_id)` and verifies the winner row.
- Conflicting content raises `DomainInvariantError` (immutable results).

## Terminal parent

Parent transitions use compare-and-swap `transitionEvaluationRun`. Completion requires **one reconciled result per suite case** (`reconcileCaseResultsForScoring`), not raw row count.

## A3 asynchronous judge seam (design only)

| Stage | Location |
| --- | --- |
| Child run terminal | Existing worker + `EvaluationCoordinator.reconcileTerminalChildRun` |
| Judge scheduling (A3) | After deterministic evaluators complete or when evaluator type is async |
| Execution | Same BullMQ worker pool; new durable judge task record (A3 persistence TBD) |
| Identity | Pin `evaluationRunId`, `evaluationCaseId`, `runAttemptId`, evaluator config hash |
| Pending judge | Case result remains unreconciled until judge task reaches terminal status |
| Errors | Judge failures → `ERROR` outcome, not `FAIL` |
| Usage | Ordinary MODEL run steps under child or judge run |

A2 does **not** persist judge tasks or invoke models.

## Deferred

- Dedicated index on `runs.evaluation_run_id` (batch sizes remain small)
- Console recovery UI
- LLM-as-judge execution (A3)