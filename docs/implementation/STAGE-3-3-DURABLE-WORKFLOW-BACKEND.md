# Stage 3.3: Durable Workflow Backend

**Status (Pass 3.3.17):** **implementation complete** — durable waits/events, HTTP event
ingestion, orchestrator wait driver, V3 execution enabled, recovery scenarios A–F covered
by tests.

**Pass 3.3.1:** documentation-only architecture freeze.

Stage 3.3 turns Stage 3.2 WAIT/Event **domain semantics** into **durable PostgreSQL-backed
execution**.

**Prerequisites (implemented):** Stage 3.2 domain + contracts — see
[`STAGE-3-2-WORKFLOW-SEMANTICS.md`](./STAGE-3-2-WORKFLOW-SEMANTICS.md),
[`WORKFLOW_DEFINITION_V3.md`](../contracts/WORKFLOW_DEFINITION_V3.md),
`packages/domain/src/workflow-wait.ts`, `packages/domain/src/workflow-event.ts`,
`packages/domain/src/workflow-wait-event.ts`.

**Related:** [`ADR-004-durable-workflow-backend.md`](../adr/ADR-004-durable-workflow-backend.md),
[`workflow-execution.md`](../architecture/flows/workflow-execution.md),
[`EXECUTION_AND_WORKFLOWS.md`](../platform/EXECUTION_AND_WORKFLOWS.md).

---

## 1. Stage 3.3 purpose

Stage 3.3 materializes **WorkflowWait** and **WorkflowEvent** in PostgreSQL and wires them
into the existing OSVA orchestration loop. It does **not** introduce a second workflow
engine.

| Principle | Stage 3.3 lock |
|-----------|----------------|
| Lifecycle authority | **PostgreSQL** (`WorkflowRun`, `WorkflowNodeRun`, waits, events) |
| Graph advancement | **ReconcileWorkflowRun** (same product mechanism as V2) |
| Queue / timers | **BullMQ is transport only** — not timer authority, not wait identity |
| History / replay | **No** Temporal or Temporal-like workflow history/replay semantics |
| Public workflow model | OSVA-owned definitions and reconciliation — adapters (ADR-004) must not redefine it |

V3 **`schemaVersion: "3"`** execution is **enabled** after Pass **3.3.17** (see §22).

---

## 2. Existing execution model

### CURRENTLY IMPLEMENTED

```text
apps/workflow-orchestrator
  → WorkflowOrchestratorTick (poll active WorkflowRuns)
  → ReconcileWorkflowRun (per run)
  → persisted WorkflowRun / WorkflowNodeRun state
  → ApprovalRequest for APPROVAL nodes
  → CreateRun + BullMQ for AGENT child Runs only
```

Key files:

- `apps/workflow-orchestrator` — polling loop
- `packages/orchestration/src/workflow-orchestrator-tick.ts`
- `packages/orchestration/src/reconcile-workflow-run.ts`
- `packages/domain/src/workflow-readiness.ts` — readiness, blocking helpers

Executable workflow definitions: **`schemaVersion: "1"`, `"2"`, and `"3"`** (V3 enabled in
Pass 3.3.17).

### Approval as the closest pattern

Human approval is the reference durable suspension path:

```text
APPROVAL node ready
  → WorkflowNodeRun: PENDING → WAITING (CAS)
  → durable ApprovalRequest (unique per workflowNodeRunId)
  → external decision (API)
  → reconciliation observes decision
  → WorkflowNodeRun advances (SUCCEEDED or FAILED)
```

WAIT follows the **same architectural philosophy** but uses **WorkflowWait** (TIMER or
EVENT), not ApprovalRequest. Timer/event **resolution** is performed by a **wait driver**
and/or **event ingestion**; **graph progression** still happens in **ReconcileWorkflowRun**
after the wait is durably resolved.

### STAGE 3.3 TARGET

Add durable **WorkflowWait** / **WorkflowEvent** rows, a **WorkflowWaitDriverTick**
(or equivalent), **`POST /v1/workflow-events`**, and reconciler stages for WAIT arm/progression
— without replacing the orchestrator/reconciler product model.

---

## 3. Stable WAIT architecture

Stage 3.2 locked APPROVAL vs WAIT separation. Stage 3.3 preserves it.

```text
APPROVAL  → ApprovalRequest     (human decision; first-class approval state)
WAIT      → WorkflowWait         (kind TIMER | EVENT)
            TIMER  → DURATION | UNTIL definition variants (frozen wakeAt)
            EVENT  → frozen criteria + optional expiresAt
WorkflowEvent → immutable observed fact (independent of waits)
```

**Do not** unify ApprovalRequest and WorkflowWait.

**Do not** create **WorkflowWaitId**.

**Canonical WorkflowWait identity:** `workflowNodeRunId` — exactly **one** WorkflowWait per
**WorkflowNodeRun**.

Domain **`WorkflowWaitKind`** is **`TIMER` | `EVENT`** (DURATION/UNTIL definitions arm as
**TIMER** waits with frozen `wakeAt`). Persistence aligns with
`WorkflowWait.rehydrate` in `packages/domain/src/workflow-wait.ts`.

---

## 4. Persistence model

Stage 3.3 introduces one cohesive wait/event persistence slice.

**Target migration (not created in Pass 3.3.1):**

`0018_workflow_wait_event_slice.sql`

One migration should eventually contain **both**:

- `workflow_waits`
- `workflow_events`

Later implementation passes may split work across Cursor passes; the **schema slice** stays
one migration file.

### Conceptual `workflow_waits` fields

**Common:**

| Field | Role |
|-------|------|
| `workflowNodeRunId` | **Primary key**; canonical wait identity |
| `workspaceId` | Scope |
| `workflowRunId` | Parent run |
| `kind` | `TIMER` \| `EVENT` |
| `armedAt` | Frozen activation instant |
| `resolution` | Terminal resolution when resolved |
| `resolvedAt` | OSVA resolution instant when resolved |
| `resolvedByEventId` | Present iff EVENT resolution |

**TIMER (`kind = TIMER`):**

| Field | Role |
|-------|------|
| `wakeAt` | Required; frozen deadline |

EVENT-specific columns **absent**.

**EVENT (`kind = EVENT`):**

| Field | Role |
|-------|------|
| `eventSource` | Frozen producer namespace (maps to event `source`) |
| `eventType` | Frozen exact type |
| `correlationKey` | Frozen opaque key |
| `eligibleFrom` | Frozen; **`WorkflowRun.createdAt`** at arm time |
| `expiresAt` | Optional timeout instant |

`wakeAt` **absent**.

Housekeeping columns (`created_at`, `updated_at`) may exist at the DB layer for operational
queries but must **not** introduce a second domain lifecycle or product identity.

### Conceptual `workflow_events` fields

| Field | Role |
|-------|------|
| `id` | **WorkflowEventId** (product identity) |
| `workspaceId` | Scope |
| `source` | Producer namespace |
| `eventType` | Exact type |
| `correlationKey` | Opaque; no normalization |
| `idempotencyKey` | Ingestion identity component |
| `payload` | Canonical JSON |
| `occurredAt` | Optional; informational only |
| `receivedAt` | **OSVA authoritative** ingestion instant |

Immutable fact: no normal UPDATE/DELETE lifecycle in Stage 3.3 operation.

---

## 5. WorkflowWait database invariants

Persisted rows must satisfy the same rules enforced by **`WorkflowWait.rehydrate`** /
`validateWorkflowWaitRehydrateProps` in domain code.

**Primary key:** `workflow_node_run_id` — no separate wait ID.

**Active wait:**

- `resolution` NULL
- `resolvedAt` NULL
- `resolvedByEventId` NULL

**Resolved wait:**

- `resolution` present
- `resolvedAt` present

**EVENT resolution:**

- `resolvedByEventId` **required**

**Non-EVENT resolution:**

- `resolvedByEventId` **absent**

**TIMER kind:**

- `wakeAt` required
- EVENT-specific columns absent
- Allowed resolutions: **`TIMER`**, **`CANCELLED`** only

**EVENT kind:**

- `eventSource`, `eventType`, `correlationKey`, `eligibleFrom` required
- `wakeAt` absent
- Allowed resolutions: **`EVENT`**, **`TIMEOUT`**, **`CANCELLED`** only
- `expiresAt` optional; when present:
  - `expiresAt > armedAt`
  - `eligibleFrom <= armedAt`
- Do **not** require `resolvedAt <= expiresAt`

---

## 6. WorkflowEvent database invariants

- **Immutable** after insert.
- **Primary identity:** `WorkflowEventId`.
- **Ingestion uniqueness:** `(workspaceId, source, idempotencyKey)`.
  - Equivalent retries (same semantic content) succeed idempotently.
  - Conflicting reuse of the same ingestion identity **fails**.
- No UPDATE/DELETE in normal Stage 3.3 operation.
- **No consume/claim state** — one event may resolve **multiple** WorkflowWaits.

---

## 7. Index architecture

Exact SQL/index syntax is implementation work. Conceptually require:

| Use case | Index / ordering concept |
|----------|---------------------------|
| TIMER discovery | Unresolved TIMER waits, `wakeAt <= now`, ordered by **`wakeAt`**, **`workflowNodeRunId`** |
| EVENT timeout discovery | Unresolved EVENT waits with `expiresAt`, ordered by **`expiresAt`**, **`workflowNodeRunId`** |
| Active EVENT wait matching | `(workspaceId, eventSource, eventType, correlationKey)` on **unresolved** EVENT waits |
| WorkflowEvent candidate lookup | `(workspaceId, source, eventType, correlationKey, receivedAt)` |
| Workflow-run scoped load | `workflowRunId` on waits (and events only if needed for debugging — not for external matching) |

---

## 8. Repository boundaries

Two **domain persistence ports** (infrastructure-agnostic; names may follow existing
`*Repository` conventions):

### `WorkflowWaitRepository`

Conceptual responsibilities:

- Save/arm a wait **idempotently** (PK on `workflowNodeRunId`)
- Find by `workflowNodeRunId`
- List by `workflowRunId`
- Discover due **TIMER** waits (`wakeAt <= now`, unresolved)
- Discover due **EVENT** timeouts (`expiresAt <= now`, unresolved)
- Lock/load a wait row for resolution (transaction + row lock)
- Persist **one winning** terminal resolution (CAS on unresolved state)

### `WorkflowEventRepository`

Conceptual responsibilities:

- Insert immutable event (ingestion identity + conflict rules)
- Find by ingestion identity
- List **candidate events** for a wait (exact match + eligibility window in application/domain layer)

Listing active waits matching an event may live on **WorkflowWaitRepository** if that fits
query shape; do not duplicate matching logic in HTTP handlers.

Load path: repository primitives → **`WorkflowWait.rehydrate`** / **`WorkflowEvent.rehydrate`**
→ domain services (`decideWorkflowEventWait`, etc.).

---

## 9. Wait arming transaction semantics

WAIT arming must be **idempotent**.

**Required correctness property:** crash after WorkflowWait persistence but before the
orchestrator returns must **not** create a second wait.

**Minimum architecture (Stage 3.3):**

1. WorkflowNodeRun becomes **WAITING** using **CAS** (same pattern as approval today).
2. Build frozen **WorkflowWait** from:
   - immutable **WorkflowVersion** WAIT definition
   - node input (correlation resolution)
   - **`WorkflowRun.createdAt`** → `eligibleFrom` for EVENT
   - **`WorkflowNodeRun.startedAt`** (frozen at `markWaiting`) → `armedAt` — not reconcile `now` on retry
3. **Insert** WorkflowWait protected by PK **`workflowNodeRunId`** (separate durable step from WAITING CAS).
4. Duplicate arm **reloads** existing wait and verifies immutable arm equivalence (`hasSameWorkflowWaitArm`); resolution fields are not compared on recovery.

**Pass 3.3.11 decision:** OSS v1 **accepts** split WAITING transition + wait INSERT. Crash before insert is repaired by reconciliation calling `ensureWorkflowWait` for WAITING nodes using persisted `startedAt`. A future improvement may combine both steps in one transaction; correctness does not depend on process memory.

**Terminal run protection (3.3.14):** TIMER/EVENT resolution transactions lock **`WorkflowRun` → `WorkflowWait`**. If the run is terminal (`SUCCEEDED` / `FAILED` / `CANCELLED`), resolution returns the active wait unchanged. Discovery queries (`listDueTimerWorkflowWaits`, `listResolvableEventWorkflowWaits`, `listActiveEventWorkflowWaitsByMatch`) exclude waits whose WorkflowRun is not `PENDING` / `RUNNING` / `WAITING`. Unresolved waits on terminal runs remain durable history; automatic cancellation propagation is deferred.

**Reference (CURRENTLY IMPLEMENTED):** `materializeReadyApprovals` /
`ensureApprovalRequest` in `reconcile-workflow-run.ts` — CAS node transition, then insert
with unique `(workflow_node_run_id)` recovery.

---

## 10. Timer architecture

**Do not** use BullMQ delayed jobs as timer authority.

Use **PostgreSQL due discovery** and a dedicated driver tick.

**Conceptual component:** `WorkflowWaitDriverTick` (or equivalent in
`apps/workflow-orchestrator` or a sibling process — prefer **one global driver**; §21).

**TIMER discovery pattern** follows **scheduler precedent** (`PostgresScheduleRepository.materializeDueOccurrences`):

- `BEGIN` transaction
- Ordered batch
- **`FOR UPDATE SKIP LOCKED`** (Drizzle: `.for("update", { skipLocked: true })`)
- Unresolved TIMER waits where **`wakeAt <= now`**

**Driver responsibility:** resolve the durable wait only (**TIMER** or idempotent retry).

**Driver does not** directly materialize DAG successors. **ReconcileWorkflowRun** observes
resolved wait and advances **WorkflowNodeRun**.

---

## 11. Event ingestion architecture

**Target flow:**

```text
POST /v1/workflow-events
  → IngestWorkflowEvent (application service)
  → immutable WorkflowEvent INSERT
  → identify matching active EVENT waits (exact tuple)
  → serialize resolution per WorkflowWait row (row lock)
  → domain eligibility + decideWorkflowEventWait
  → persist EVENT (or no-op) resolution
  → ReconcileWorkflowRun (later tick) advances graph
```

**Exact, case-sensitive matching** (no WorkflowRun id in external matching):

```text
workspaceId + source + eventType + correlationKey
```

(wait row stores `eventSource`; event stores `source` — same semantic namespace.)

One event may satisfy **multiple** waits. **No consume semantics.**

Ingest-time matching is the **low-latency fast path**; durable correctness must not depend
on it exclusively (§20).

---

## 12. Event eligibility

Freeze **Stage 3.2** semantics (do not change):

- **`eligibleFrom = WorkflowRun.createdAt`** (frozen at arm time)
- Eligible when:
  - `event.receivedAt >= eligibleFrom`
  - if `expiresAt` exists: `event.receivedAt <= expiresAt`
- `occurredAt` is **informational only**
- Events received after run creation but **before** WAIT arm may still satisfy the wait

Domain: `isWorkflowEventEligibleForWait` in `workflow-wait-event.ts`.

---

## 13. Deterministic event selection

When multiple candidate events are eligible, **`selectWorkflowEventForWait`**:

1. Earliest **`receivedAt`**
2. Lexicographic **`WorkflowEventId`** tie-break

Do **not** rely on database default ordering, **`occurredAt`**, or **`idempotencyKey`**.

---

## 14. Event vs timeout race

**Critical Stage 3.3 invariant:** **TIMEOUT** must never commit without checking durable
eligible events.

**Required pattern:**

```text
BEGIN
  lock WorkflowWait row
  load eligible matching WorkflowEvents (durable query)
  decision = decideWorkflowEventWait(wait, events, now)
  if EVENT → persist EVENT resolution (+ resolvedByEventId)
  else if TIMEOUT → persist TIMEOUT resolution
  else → no change
COMMIT
```

An event durably received **on or before** `expiresAt` wins even when processing runs
**after** `expiresAt`.

**Example:**

- `expiresAt = 11:00`
- `event.receivedAt = 10:59`
- timeout worker runs at `11:05`

**Result:** **EVENT**, not **TIMEOUT**.

---

## 15. Event ingestion vs timeout concurrency

Event resolution and timeout resolution **serialize through the WorkflowWait row**
(PostgreSQL row lock + CAS on unresolved columns).

Exactly **one** terminal wait resolution wins.

Same terminal resolution retry may be **idempotent**.

Conflicting terminal resolution must **not** replace existing state.

Queue/job/scheduler delivery IDs are **not** workflow identity.

**Reference (CURRENTLY IMPLEMENTED):** Approval decision persistence uses
`saveApprovalRequestTransition(expectedStatus, next)` CAS on status — analogous pattern for
wait resolution columns.

---

## 16. Terminal workflow protection

Before committing wait resolution, durable services must prevent **workflow resurrection**.

If **WorkflowRun** is terminal (**SUCCEEDED**, **FAILED**, **CANCELLED**):

- late TIMER / EVENT activity must **not** cause workflow progress

Stage 3.3 must add the **durable guard** needed for waits (Pass **3.3.14**).

Child **Run** completion already cannot resurrect a failed workflow; the same principle
applies to terminal **WorkflowRun** + late wait resolution.

Operational **WorkflowRun cancellation API** remains deferred unless explicitly pulled into
Stage 3.3.

---

## 17. Reconciliation changes

**Do not modify reconciler in Pass 3.3.1.** Target pipeline (ordering must be validated
against `reconcile-workflow-run.ts` before implementation):

1. Observe **resolved waits** (TIMER / EVENT / TIMEOUT — not CANCELLED progression)
2. Observe **approval decisions** (existing)
3. Observe **child Run** results (existing)
4. Resolve graph/orchestration nodes (BRANCH / PARALLEL / JOIN)
5. Materialize ready **AGENT** nodes
6. Materialize ready **APPROVAL** nodes
7. Materialize ready **WAIT** nodes (arm WorkflowWait)
8. Derive **WorkflowRun** lifecycle

**CURRENTLY IMPLEMENTED order (V1/V2):** observe agents → failure short-circuit → observe
approvals → propagate skips → resolve orchestration → propagate skips → materialize
approvals → start agents → derive status. **No** wait observe/arm stages yet.

### WAIT progression (target)

| Resolved wait | WorkflowNodeRun |
|---------------|-----------------|
| TIMER | **SUCCEEDED** |
| EVENT | **SUCCEEDED** |
| TIMEOUT | **FAILED** with stable **`WORKFLOW_EVENT_TIMEOUT`** |
| CANCELLED | must **not** resume workflow |

**Output:** pass through WAIT **input** unchanged (Stage 3.2 / V3 contract).

---

## 18. WorkflowRun WAITING derivation

Generalize approval-only blocking (**Pass 3.3.13**).

**WorkflowRun** is **WAITING** only when:

- no **independently progressing** work exists, **and**
- external/timer suspension is the blocker

If an **AGENT** is still actively **RUNNING** in a parallel branch, **WorkflowRun** stays
**RUNNING**.

**WAITING** may be caused by **APPROVAL** or **WAIT** suspension.

Do **not** equate “any WorkflowNodeRun in WAITING” with **WorkflowRun WAITING**.

**CURRENTLY IMPLEMENTED:** `deriveActiveWorkflowStatus` uses
`isWorkflowBlockedOnApproval` only — sufficient for V2 approval-only graphs, insufficient
for V3 parallel AGENT + WAIT without generalization.

---

## 19. Crash recovery

| Scenario | Required behavior |
|----------|-------------------|
| **A.** Wait persisted before orchestrator returns | Reconcile finds wait by `workflowNodeRunId`; **no second arm** |
| **B.** Wait resolution committed before node progression | Reconcile observes resolved wait; advances node; **no re-resolve** |
| **C.** Node succeeded before successor materialization | DAG readiness re-derives successors (existing idempotent reconcile) |
| **D.** Duplicate timer processing | **No** duplicate logical resolution |
| **E.** Duplicate event processing | **No** duplicate logical resolution |
| **F.** Event INSERT committed before ingest-time wait matching | Event remains durable; timeout/recovery path must still discover it; **no event loss** because ingest died after INSERT |

Scenario **F** is **mandatory** in Stage 3.3 architecture (§20).

---

## 20. Important challenge: ingest-only matching

**Do not** make correctness depend exclusively on synchronous ingest-time matching.

If the process crashes after event **INSERT** but before matching waits, the system must
still eventually resolve eligible waits.

**Acceptable minimal approaches:**

| Option | Description |
|--------|-------------|
| **A** | EVENT wait driver also scans/re-evaluates active EVENT waits |
| **B** | Reconciliation for active EVENT waits checks durable candidate events |
| **C** | Outbox/work queue (defer unless necessary) |

**Prefer** the smallest **PostgreSQL-native** solution (A or B). **Do not** introduce
Kafka/outbox machinery unless genuinely necessary.

### Pass 3.3.10 decision status (IMPLEMENTED)

**Fast path:** `IngestWorkflowEvent` persists the canonical `WorkflowEvent`, then matches
active EVENT waits and calls **`WorkflowEventWaitResolutionRepository.resolveWorkflowEventWait`**
per wait.

**Correctness path:** `ProcessResolvableEventWaits` discovers resolvable EVENT waits via
`listResolvableEventWorkflowWaits` (timeout due **or** durable eligible event exists) and
invokes the same atomic resolver. This covers scenario **F** (event INSERT committed before
matching; no client retry required).

Ingest-time matching is a latency optimization only; durable correctness does not depend on
process memory or client retry.

### Pass 3.3.8 isolation note (IMPLEMENTED)

`PostgresWorkflowEventWaitResolutionRepository` uses **READ COMMITTED** (PostgreSQL default)
with **`SELECT … FOR UPDATE`** on the `workflow_waits` row. Candidate `workflow_events` are
read in the same transaction after the wait row lock. A TIMEOUT decision therefore observes
only events committed and visible before candidate lookup in that transaction. This does
**not** claim SERIALIZABLE semantics.

---

## 21. Driver architecture

Stage 3.3 may use **one global wait driver** with:

- **`processDueTimerWaits`**
- **`processDueEventWaits`** (timeouts + durable recovery — §20)

Prefer one process over many unless implementation proves otherwise. Class/function names are
**not** frozen.

Wire into **`apps/workflow-orchestrator`** in Pass **3.3.16** (integration smoke).

---

## 22. V3 execution gate

**Satisfied in Pass 3.3.17.** V3 is executable; the checklist below was required before
adding **`"3"`** to executable workflow schema versions:

1. WorkflowWait persistence
2. WorkflowEvent persistence
3. Idempotent wait arm
4. Timer discovery
5. Event candidate lookup
6. Event-vs-timeout race correctness
7. One winning wait resolution
8. WAIT node progression
9. Reconciliation after resolution
10. Crash recovery (including §19 **F**)
11. Multi-orchestrator safety
12. Terminal resurrection protection
13. Event-persisted-before-match crash recovery

Then enable V3, add end-to-end tests, and run **`pnpm verify:ci:clean`**.

---

## 23. Explicit deferrals

Do **not** include in Stage 3.3 unless architecture forces reconsideration:

- Temporal / Inngest-style engines as OSVA lifecycle authority
- **`DurableWorkflowBackend`** abstraction for the primary PostgreSQL path (ADR-004 remains
  adapter-only for optional external engines)
- Kafka / external event broker as lifecycle authority
- BullMQ timer authority
- **WorkflowWaitId**
- ApprovalRequest unification
- Workflow retry DSL
- Wildcard event matching / arbitrary expressions
- Subworkflows / loop DSL
- Operational WorkflowRun cancellation API
- Separate event worker process (unless driver split proves necessary)
- Observability implementation details
- Automatic event retention/GC
- Artifacts / knowledge / MCP Stage 3.4+ work

---

## 24. Security

**WorkflowEvent** input is untrusted.

**`POST /v1/workflow-events`** (Pass 3.3.15) enforces bounds on:

- `source`, `eventType`, `correlationKey`, `idempotencyKey`, payload size

Do **not** log **payload** or **correlationKey** by default.

Safe log dimensions: `WorkflowEventId`, `workflowRunId`, `workflowNodeRunId`, wait `kind`,
`source`, `eventType`, `resolution`.

**Implemented in Pass 3.3.15.**

---

## 25. Implementation pass plan

Bounded passes (one Stage 3.3 product commit at the end):

| Pass | Scope |
|------|--------|
| **3.3.1** | Architecture documentation only (**this document**) |
| **3.3.2** | One migration: **both** `workflow_waits` + `workflow_events` schemas/constraints; DB integration tests only |
| **3.3.3** | Domain repository ports + in-memory fakes for orchestration tests |
| **3.3.4** | `PostgresWorkflowWaitRepository`: insert/find/list/rehydrate/idempotent arm |
| **3.3.5** | `PostgresWorkflowEventRepository`: ingestion identity/idempotency/conflict/candidates |
| **3.3.6** | Wait resolution concurrency/CAS/locking; concurrent resolution tests — checkpoint **`pnpm verify:quick`** |

**Pass 3.3.6 note:** `saveWorkflowWaitResolution` CAS persists terminal resolution only.
It does **not** implement EVENT-vs-TIMEOUT atomicity (checklist item 6); Pass **3.3.8**
must combine row serialization, durable candidate event lookup, and
`decideWorkflowEventWait` in one PostgreSQL boundary.
| **3.3.7** | Due TIMER processing |

**Pass 3.3.7 note:** TIMER due discovery uses indexed `listDueTimerWorkflowWaits`
plus `saveWorkflowWaitResolution` CAS. Correctness is **CAS-backed**; `FOR UPDATE
SKIP LOCKED` remains a future optimization if discovery and resolution are combined
in one transaction.
| **3.3.8** | EVENT timeout path + durable candidate lookup + `decideWorkflowEventWait` |
| **3.3.9** | Event ingestion application service + low-latency matching |
| **3.3.10** | Crash recovery for event persisted before matching; choose smallest PG-native path (§20) |
| **3.3.11** | Reconcile WAIT arming |
| **3.3.12** | Reconcile resolved WAIT progression — checkpoint **`pnpm verify:quick`** |
| **3.3.13** | Generalize WorkflowRun WAITING derivation (APPROVAL + WAIT) |
| **3.3.14** | Terminal workflow resurrection guards |
| **3.3.15** | Expose **`POST /v1/workflow-events`** |
| **3.3.16** | Wire wait driver into workflow-orchestrator + integration smoke — checkpoint **`pnpm verify:quick`** |
| **3.3.17** | Full Stage 3.3 checklist review; enable V3 execution + E2E; **`pnpm verify:ci:clean`** |

---

## 26. Architecture review vs current repository

Compared against approval persistence, scheduler concurrency, WorkflowRun CAS, repository
patterns, and active workflow scanning. **No fixes in 3.3.1** — discrepancies to address in
implementation passes.

| Topic | CURRENTLY IMPLEMENTED | Stage 3.3 target / note |
|-------|----------------------|-------------------------|
| Wait/event tables | **Absent** | Migration `0018_*` in 3.3.2 |
| Reconciler WAIT stages | **Absent** | §17 ordering TBD vs current pipeline |
| `resolveOrchestrationNodes` | Excludes **AGENT** and **APPROVAL** | Must exclude **WAIT** when V3 executes |
| Approval arming | Split CAS + insert with unique recovery | Model for WAIT arming (§9); atomic combine TBD in 3.3.11 |
| `isWorkflowBlockedOnApproval` | Approval-centric blocking helper | Generalize to APPROVAL + WAIT (3.3.13) |
| WorkflowRun WAITING | Derived only via approval blocking | Parallel RUNNING AGENT + WAIT branch (Stage 3.2 semantics) |
| Timer discovery | N/A | Mirror scheduler: transaction + order + **SKIP LOCKED** (`postgres-schedule-repository.ts`) |
| Row locking syntax | Drizzle `.for("update", { skipLocked: true })` | Same pattern for wait driver (not raw SQL requirement in docs) |
| Domain repository transactions | **No** cross-port transaction API | Postgres adapters use `db.transaction` internally (scheduler precedent) |
| Active workflow scan | `listActiveWorkflowRuns(limit)` default **50** per tick | Wait driver uses **global** due-wait queries, not limited to active-run poll |
| Terminal resurrection on late approval | Reconciler returns early on terminal **WorkflowRun** in many paths; late decision edge cases not wait-guarded | Explicit durable guards for waits (3.3.14); align approval if gaps found |
| ADR-004 `DurableWorkflowBackend` | Accepted adapter pattern | Stage 3.3 **primary** path is PostgreSQL reconciliation — not a second engine |
| BullMQ | Child Run transport only | Unchanged; **not** timer authority |

---

## 27. Other documentation

**Pass 3.3.1 updates (minimal):**

- [`workflow-execution.md`](../architecture/flows/workflow-execution.md) — pointer to this doc; CURRENTLY IMPLEMENTED vs Stage 3.3 target
- [`EXECUTION_AND_WORKFLOWS.md`](../platform/EXECUTION_AND_WORKFLOWS.md) — same distinction

**Not updated in 3.3.1:** `AGENTS.md` (invariants already cover WorkflowNodeRunId, events,
terminal workflows). **`DATA_MODEL.md`** gains wait/event tables when migration lands (3.3.2).

Do **not** claim wait/event persistence exists yet.

---

## 28. References

- [`STAGE-3-2-WORKFLOW-SEMANTICS.md`](./STAGE-3-2-WORKFLOW-SEMANTICS.md)
- [`WORKFLOW_DEFINITION_V3.md`](../contracts/WORKFLOW_DEFINITION_V3.md)
- [`ARCHITECTURAL_INVARIANTS.md`](../architecture/ARCHITECTURAL_INVARIANTS.md)
- [`DATA_MODEL.md`](../architecture/DATA_MODEL.md)
- [`workflow-execution.md`](../architecture/flows/workflow-execution.md)
- [`EXECUTION_AND_WORKFLOWS.md`](../platform/EXECUTION_AND_WORKFLOWS.md)
- [`ADR-004-durable-workflow-backend.md`](../adr/ADR-004-durable-workflow-backend.md)
- `packages/orchestration/src/reconcile-workflow-run.ts`
- `packages/db/src/repositories/postgres-schedule-repository.ts`
- `packages/db/src/repositories/postgres-approval-request-repository.ts`
- `packages/domain/src/workflow-wait.ts`
- `packages/domain/src/workflow-event.ts`
- `packages/domain/src/workflow-wait-event.ts`
