# Run Execution Flow

## Purpose

Create a Run, snapshot immutable bindings, enqueue execution, drive one RunAttempt through a runtime adapter to terminal state, and record RunSteps.

## Trigger / entry point

- **API:** `POST /v1/runs` (`apps/web/src/run-http.ts`)
- **Internal:** `CreateRun.execute` from workflow reconciler, scheduler, or evaluation run starter

## Step-by-step flow

1. **Validate ownership:** `CreateRun` loads AgentVersion via `AgentRepository`; callers cannot override binding snapshot.
2. **Persist PENDING:** Atomically create Run (with `EffectiveRunBindings`) and first RunAttempt (PENDING).
3. **Transition QUEUED:** Run → QUEUED with expected-state semantics; RunAttempt remains PENDING until worker starts.
4. **Enqueue transport:** `JobQueue.enqueue(runAttemptId)` — payload is `{ runAttemptId }` only. BullMQ job ID is encoded separately (`toBullMqJobId`); not an OSVA identity.
5. **Worker consume:** `apps/worker` handler receives payload, calls `ExecuteRunAttempt.execute`.
6. **Load persisted state:** Worker loads Run, RunAttempt, AgentVersion; verifies binding consistency.
7. **Build request:** `createExecutionRequest` produces frozen `ExecutionRequest` from DB snapshots (including `evaluationContext` when present).
8. **Dispatch runtime:** `RuntimeDispatcher` selects adapter from `AgentVersion.manifest.runtime` (`TRUSTED_TYPESCRIPT`, `REMOTE_HTTP`, or `CONTAINER`).
9. **Execute:** Runtime adapter runs agent code; model/tool/memory calls go through gateway-wrapped capabilities (in-process, remote HTTP, or container capability bridge).
10. **Persist terminal:** RunAttempt → terminal; Run → matching terminal state. Adapter throws are normalized to FAILED, not left RUNNING.
11. **RunSteps:** Gateway wrappers persist step records with usage/cost where available.
12. **Evaluation hook:** If evaluation child Run, `EvaluationCoordinator.reconcileTerminalChildRun` after terminal attempt.

## Persisted objects

| Object | Authority | Notes |
|--------|-----------|-------|
| Run | PostgreSQL | Owns `effectiveBindings`, input, terminal status |
| RunAttempt | PostgreSQL | Canonical attempt id; queue redelivery reuses same id |
| RunStep | PostgreSQL | Append-only observability |
| BullMQ job | Valkey | Transport only; redelivery ≠ new RunAttempt |

## Immutability / idempotency

- **AgentVersion** and bound ToolVersion/ModelProfileVersion/MemoryNamespace bindings are immutable; Run stores snapshot at creation.
- **Queue redelivery** reuses the same RunAttemptId (and Runtime Protocol `executionId`).
- **New logical retry** creates a new RunAttemptId (separate API/orchestration concern when implemented).
- **CreateRun idempotencyKey** (when supplied) prevents duplicate Run creation at application level.

## Failure / cancellation

- Enqueue failure after QUEUED persist: CreateRun fails; durable QUEUED rows remain recoverable. The worker recovery ticker re-enqueues the same RunAttempt ID.
- PENDING → RUNNING acquires an execution lease (`execution_owner`, `execution_generation`, `lease_expires_at` via PostgreSQL `now()`). Only the owner may heartbeat or persist a terminal outcome.
- Abandoned leased RUNNING attempts are failed in place with `EXECUTION_INTERRUPTED`. They are never automatically re-executed and never get a new RunAttempt.
- Runtime adapter failure: FAILED RunAttempt with normalized error code/message.
- Already terminal / already in progress / ownership-lost: idempotent handler outcomes without duplicate execution side effects.
- BullMQ retry/redelivery: worker re-delivers the same RunAttemptId; ExecuteRunAttempt no-ops RUNNING and terminal attempts.
- See [`docs/operations/EXECUTION_RECOVERY.md`](../../operations/EXECUTION_RECOVERY.md).

## Diagram

```mermaid
sequenceDiagram
  participant API as apps/web
  participant PG as PostgreSQL
  participant BQ as BullMQ
  participant W as apps/worker
  participant RT as RuntimeDispatcher
  participant GW as Gateways

  API->>PG: persist PENDING Run + RunAttempt
  API->>PG: transition Run to QUEUED
  API->>BQ: enqueue runAttemptId
  BQ->>W: deliver job
  W->>PG: load Run, RunAttempt, AgentVersion
  W->>RT: execute(ExecutionRequest)
  RT->>GW: model / tool / memory capabilities
  GW->>PG: RunSteps
  RT-->>W: ExecutionResult
  W->>PG: terminal RunAttempt + Run
```

## Key implementation files

- `packages/orchestration/src/create-run.ts`
- `packages/orchestration/src/execute-run-attempt.ts`
- `packages/orchestration/src/execution-recovery-tick.ts`
- `packages/runtime-core/src/create-execution-request.ts`
- `packages/runtime-core/src/runtime-dispatcher.ts`
- `adapters/bullmq/src/bullmq-job-queue.ts`
- `adapters/runtime-container/src/container-runtime-adapter.ts`
- `apps/worker/src/execute-run-attempt-handler.ts`
- `packages/domain/src/effective-run-bindings.ts`
- `packages/domain/src/run-state-machine.ts`
