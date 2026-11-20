# ADR-013: Workspace Inference Budget Authority

**Status:** PROPOSED (B5.0R final corrections; pending human approval before B5.1)

**Date:** 2026-11-20

**Supersedes:** Informal B5.0 placement sketch (budget decorator outside routing; `onProviderAttempt` as admission hook).

**Related:** ADR-012, `docs/implementation/B5_INFERENCE_BUDGET_ARCHITECTURE.md`, `docs/operations/B5_INFERENCE_BUDGET_ACCEPTANCE_MATRIX.md`

## Context

OSVA persists authoritative inference accounting on PostgreSQL `run_steps`, aggregates usage per `RunAttempt`, and optional B1–B4 features (exact-response cache, routing, batch) change **when** provider HTTP occurs but not **who** owns lifecycle state.

B4 exposes `maxEstimatedCostUsdMicros` as a **soft routing preflight** (candidate filtering only). There is **no** workspace-period spend ledger, **no** reserve-before-provider protocol, and **no** cross-worker atomic admission.

Architecture review (B5.0R) identified correctness gaps:

1. **Execution boundary** — `onProviderAttempt` runs **after** `invoke()` returns (`routing-model-gateway.ts`); it is telemetry-only and unsuitable for preflight admission.
2. **Reservation identity** — `RunStepId` is allocated at step start via `randomUUID()` (`run-step-recorder.ts`) and is **not stable** across worker recovery or execution replay; budget authority requires a **durable inference invocation** row in PostgreSQL before provider I/O.
3. **State transitions** — Null cost must not commit as zero; uncertain billable liability must not auto-release.
4. **Semantics** — Atomic reservations, estimates, actuals, unknown liabilities, and invoice true-up must remain distinct.

Constraints from `AGENTS.md`:

- PostgreSQL is canonical lifecycle and accounting authority.
- Model calls are mediated by ModelGateway.
- Provider SDK types stay out of contracts.
- Default-off policies; fail closed on authorization and ledger errors.

## Decision

### 1. Admission boundary (verified stack)

**Today (worker, agent runs):**

```text
RunStepRecorder.wrap (ObservabilityModelGateway)
  → RoutingModelGateway
      → CachingModelGateway?  (when exact-response cache port configured)
          → ModelGateway
              → ModelProviderAdapter (provider HTTP)
```

Evidence: `apps/worker/src/process.ts` (`scopedModel`), `packages/observability/src/run-step-recorder.ts`.

**B5 target stack (default-off until workspace policy + worker compose flag enabled):**

```text
RunStepRecorder.wrap
  → RoutingModelGateway
      → CachingModelGateway
          → BudgetEnforcingModelGateway   ← single mandatory provider gate
              → ModelGateway
```

**Admission executes in `BudgetEnforcingModelGateway` immediately before delegating to `ModelGateway` methods that reach `invokeProviderGenerate` / `generateCompletionStream` (provider stream start).**

Ordering guarantees:

| Stage | Component | Billable? |
| --- | --- | --- |
| RunStep created | `RunStepRecorder` (`insertRunningRunStep`) | No |
| Route selection | `RoutingModelGateway.resolveRoutingSelection` / stream pre-select | No |
| OSVA exact-response cache | `CachingModelGateway.tryCacheRead` | No (return before Budget) |
| **Budget admission** | `BudgetEnforcingModelGateway` | Reserves liability, may deny |
| Provider HTTP | `ModelGateway` → adapter | Yes |
| Durable invocation allocated | PostgreSQL `inference_invocations` (B5 migration) | Before provider |
| Post provider | **Budget reservation ledger** + optional RunStep correlation | Reconcile reservation (not RunStep-only) |

**Explicit rejection:** `routing.onProviderAttempt` remains **post-invocation** observability only; budget code must not depend on it for admission.

**Pre-invocation attempt context** (contracts: `InferenceBudgetProviderAttemptContextV1`): passed **before** each provider call with durable `inferenceInvocationId`, `providerAttemptIndex`, `selectedModelProfileVersionId`, `workspaceId`, immutable **pricing snapshot id**, and period/policy snapshot ids. Populated by `BudgetEnforcingModelGateway` after allocation; routing supplies `providerAttemptIndex` per loop iteration **before** `invoke()`.

**Routing fallbacks:** Each fallback iteration with a new selected model gets a new `providerAttemptIndex` and **new reservation row** under the same `inferenceInvocationId` when it is the same logical model operation; budget denial on any iteration does not trigger routing fallback (see §6).

**Streaming:** Admission at **stream open** (before first provider byte); one primary reservation per `inferenceInvocationId` + `providerAttemptIndex`; stream-specific liability rules in architecture spec.

**SDK retries:** When workspace budget policy is enabled, connection-resolved adapters must use **zero hidden SDK retries** (existing OpenAI pattern). Budget treats undisclosed multi-HTTP SDK retries as a policy violation and reconciliation risk, not as exactly-once execution.

### 2. Durable invocation and reservation identity

#### 2.1 Durable inference invocation (before provider I/O)

Allocate and persist **`InferenceInvocationId`** in PostgreSQL (`inference_invocations`, migration `0044+`) **before** budget admission and **before** adapter HTTP. Pattern follows durable idempotency anchors used by `run_operation_journal` (`packages/db/src/schema/run-operation-journal.ts`: workspace-scoped row, unique logical key per execution scope).

| Field (proposed) | Purpose |
| --- | --- |
| `id` | `InferenceInvocationId` (server-generated UUID) |
| `workspace_id` | Isolation |
| `invocation_anchor` | Deterministic string; unique per billable logical operation |
| `run_attempt_id` / judge / batch foreign keys | Correlation |
| `execution_generation` | RunAttempt fence (when applicable) |
| `invocation_kind` | `SYNC` \| `STREAM` \| `JUDGE` \| `BATCH` |
| `period_key`, `budget_policy_version_id` | **Immutable** for late reconciliation |
| `run_step_id` | Optional correlation; may be reassigned on replay |

**Unique constraint:** `(workspace_id, invocation_anchor)` — `INSERT … ON CONFLICT` returns existing id for **execution replay** without double reserve.

**Invocation anchor** (deterministic, versioned contract):

```text
anchor = join(
  ANCHOR_FORMAT_VERSION,
  scope,
  runAttemptId | judgeTaskId | batchItemId,
  executionGeneration?,   -- required for agent scopes when present on RunAttempt
  bindingName | judgeSlot | batchCorrelationId,
  modelInvocationOrdinal, -- runtime- or worker-issued monotonic per attempt+binding
)
```

`RunStepId` is **not** part of the anchor. Recorder may create a new `RunStepId` on replay while the anchor stays stable → same `InferenceInvocationId` → idempotent reservation.

| Scenario | Anchor behavior | New reservation? |
| --- | --- | --- |
| **Normal invocation** | New ordinal within attempt | Yes (first admit) |
| **Routing fallback attempt** | Same `InferenceInvocationId`; new `providerAttemptIndex` | Yes (per provider HTTP) |
| **Streaming** | Same anchor rules; `invocation_kind: STREAM` | One admit at stream open |
| **Execution replay** (same attempt, generation, ordinal) | Same anchor → same invocation row | **No** double reserve |
| **Logical retry** (new `RunAttemptId`) | New anchor | Yes |
| **Genuinely new billable call** (new ordinal) | New anchor | Yes |
| **Judge invocation** | `evaluationJudgeTaskId` + `sequence` | Per judge HTTP |
| **Batch item** | `batchInferenceItemId` (+ submit generation if needed) | Admit at **provider submit**, not only reconcile |

**Reservation idempotency** — unique `(workspace_id, reservation_key)` where:

```text
reservation_key = H(
  RESERVATION_KEY_VERSION,
  inferenceInvocationId,
  providerAttemptIndex,
  selectedModelProfileVersionId,
)
```

**Reservation idempotency ≠ exactly-once provider execution.** OSVA does **not** claim exactly-once provider HTTP unless **both** (a) execution fencing (`executionGeneration` + RunAttempt lease) prevents duplicate runtime entry for the same anchor, and (b) the provider adapter performs at most one observable HTTP per admitted `providerAttemptIndex` (SDK retries disabled when budget is enabled). Budget guarantees **at-most-once capacity charge per reservation key**, not provider-side idempotency.

### 3. Authority model

- **Period balances** and **reservations** live in PostgreSQL only (not Valkey, not BullMQ).
- **Admission:** transaction with `SELECT … FOR UPDATE` on workspace budget period row (pattern reuse from `packages/db/src/repositories/identity-owner-scope.ts`).
- **Calendar period:** `CALENDAR_MONTH_UTC` — see architecture spec for deterministic boundaries.
- **Default disabled:** no activation row → Budget gateway is no-op pass-through.

### 4. Semantic classes (non-interchangeable)

| Class | Meaning | Enforcement |
| --- | --- | --- |
| **A. Atomic reservation admission** | Concurrent admits respect **available capacity** (see architecture spec invariant); mutually exclusive `committed`, `held`, `uncertain` buckets | PostgreSQL admit transaction |
| **B. Estimated cost accounting** | `estimateModelCostUsdMicros` / routing preflight on RunSteps and batch lines | Reporting only unless wired into admit ceiling |
| **C. Actual provider charges (OSVA view)** | Token usage → estimated USD; reconciled on **reservation ledger** first | `COMMITTED` or `RECONCILIATION_REQUIRED`; RunStep finalize is correlation, not sole authority |
| **D. Unknown liabilities** | Incomplete usage, null pricing, provider accepted request without usage | Remain **HELD** or **RECONCILIATION_REQUIRED**; never auto-zero |
| **E. Provider invoice reconciliation** | External true-up | Out of band; may record `invoice_overage_usd_micros` without retroactive cap |

**Product language:** A is a **workspace-period concurrent guarantee** under OSVA pricing and admission rules, **not** a guarantee against provider invoice variance (E).

### 5. Invocation path coverage

| Path | Stack | Admission point |
| --- | --- | --- |
| Agent sync text/completion | Recorder → Routing → Caching → **Budget** → Model | Budget before provider |
| Agent streaming | Recorder → Routing → Caching → **Budget** → Model stream | Budget at stream open |
| OSVA cache hit | Caching return | **Skipped** |
| Provider prompt-cache hit | Provider HTTP | Budget before provider |
| Routing fallback | Per-iteration Budget | Each attempt index |
| Evaluation judge | **Budget** → Model (no routing/cache) | Before `generateCompletionOutcome` |
| Batch inference | Orchestration service | **Admit before provider batch item submission**; reconcile on item outcome (see spec) |
| Remote HTTP runtime | `RuntimeCapabilityBridge` → `createScopedModelGateway` | Same as agent |

### 6. Error handling and routing interaction

- Ledger or authorization failure → deny admit (`MODEL_INFERENCE_BUDGET_EXCEEDED` or `MODEL_INFERENCE_BUDGET_UNAVAILABLE`), **fail closed**, no provider call.
- `MODEL_INFERENCE_BUDGET_EXCEEDED` is **`retryable: false`** and classified as **non-fallback** (same class as `MODEL_ROUTING_BUDGET_EXCEEDED` in `isNonFallbackRoutingError`). Routing **must not** advance to the next model when admission fails.
- Disabled policy → pass-through (backward compatible).

### 7. Reconciliation durability

Reservation state transitions are owned by **`InferenceBudgetAdmissionPort`** and a **budget reconciliation tick** (worker or scheduler). They **must not** depend exclusively on `RunStepRecorder.finalizeSafely` (best-effort persistence).

- Provider returns → budget gateway records `PROVIDER_STARTED` → `COMMITTED` / `RECONCILIATION_REQUIRED` in the same request when possible.
- RunStep finalize **may** supply correlation (tokens, cost) but failure to finalize **retains** held or uncertain capacity until reconciliation succeeds.
- Unknown billability → `RECONCILIATION_REQUIRED`; capacity stays in **uncertain** bucket until resolved.
- Each reservation row stores **`period_key`** and **`budget_policy_version_id`** at admit time for late reconciliation across month boundaries (charges apply to admit period, not reconcile wall clock).

## Alternatives considered

### A. Valkey atomic counters for workspace spend

**Rejected:** Not transactional with RunStep lifecycle; split brain vs PostgreSQL authority.

### B. Admission in RunStepRecorder only

**Rejected:** Judge and batch bypass recorder; routing fallbacks need per-attempt gate inside inner loop; cache hit path must not call recorder admission twice.

### C. Admission via `onProviderAttempt`

**Rejected:** Callback fires after invocation (`routing-model-gateway.ts` lines 356–365, 417–422).

### D. RunStepId-only idempotency key

**Rejected:** `RunStepId` is ephemeral across replay; fallback attempts share one RunStep but multiple provider calls.

### E. RunStep finalize as sole reconcile trigger

**Rejected:** `finalizeSafely` swallows errors for observability; budget liability must survive RunStep persistence failures.

## Consequences

**Positive**

- Single non-bypassable provider gate when enabled.
- Aligns with existing decorator pattern (Caching, Routing).
- Clear separation of reservation idempotency vs provider exactly-once.

**Negative**

- Extra transaction latency per provider attempt (including fallbacks).
- Workspace row contention under extreme parallelism.
- Judge/batch require explicit second wiring (not automatic from agent path).

## Verification

Implement per `docs/operations/B5_INFERENCE_BUDGET_ACCEPTANCE_MATRIX.md`. Use `docs/engineering/OSVA_VERIFICATION_STRATEGY.md` at B5.x integration checkpoints (no broad suites in B5.0R).

## Git safety

B5.0R is documentation only; no production behavior change in this milestone.