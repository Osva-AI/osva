# Stage 3.2: Stable Workflow Definition + Wait/Event Semantics

**Pass 3.2.1:** documentation-only semantics freeze.

**Pass 3.2.2 (implemented):** WorkflowRun and WorkflowNodeRun lifecycle
vocabulary — `WAITING` replaces `WAITING_FOR_APPROVAL`; `CANCELLED` is a legal
terminal state in contracts, domain, persistence, and API schemas. Approval
orchestration uses `WAITING`; cancellation commands and propagation are not
implemented yet.

**Pass 3.2.3 (implemented):** Persisted `schemaVersion: "3"` contract — Zod +
domain DAG validation including WAIT nodes. V3 WorkflowVersions may be created;
`CreateWorkflowRun` rejects V3 until WAIT execution lands.

**Pass 3.2.4 (implemented):** Pure `WorkflowWait` domain model — arming from V3
WAIT definitions, frozen TIMER/EVENT criteria, timer/timeout/cancellation
resolution semantics. No persistence or orchestration yet.

**Pass 3.2.5A (implemented):** Immutable `WorkflowEvent` domain entity and
ingestion idempotency semantics.

**Pass 3.2.5B (implemented):** Pure event/wait connection in
`packages/domain/src/workflow-wait-event.ts` — exact matching, eligibility
window, deterministic multi-event selection, `decideWorkflowEventWait`
(event-vs-timeout precedence), and EVENT `WorkflowWait` resolution
(`resolvedByEventId`).

**Pass 3.2.6 (implemented):** Stage 3.2 semantic closure — `WorkflowWait.rehydrate`
and `WorkflowEvent.rehydrate`, persisted-state invariant validation, final
APPROVAL vs WAIT architecture lock, cancellation/security/observability
closure, V3 execution-enablement gate, and explicit Stage 3.3 persistence /
concurrency / crash-recovery handoff. **No** PostgreSQL, APIs, orchestration, or
V3 execution in this pass.

Stage 3.3 implements durable waits/events and WAIT reconciliation. V3 execution
remains blocked until the enablement checklist below is satisfied.

**Product name:** Stable Workflow Definition v1 (OSS 1.0 milestone).

**Persisted wire schema:** `schemaVersion: "3"` (see
[`WORKFLOW_DEFINITION_V3.md`](../contracts/WORKFLOW_DEFINITION_V3.md)).

Historical `schemaVersion: "1"` and `"2"` WorkflowVersions remain valid,
immutable contracts. They are not redefined by Stage 3.2.

## Goals

- Freeze OSVA-owned workflow orchestration semantics before changing production
  code.
- Introduce a **stable** Workflow Definition contract (`schemaVersion: "3"`)
  with explicit **WAIT** (duration, absolute time, external event) semantics.
- Introduce conceptual **WorkflowWait** (1:1 with `WorkflowNodeRun`) and
  **WorkflowEvent** (immutable externally observed facts) without prescribing
  PostgreSQL shapes in this pass.
- Preserve V2 behavior for **BRANCH**, **PARALLEL**, **JOIN**, and
  **APPROVAL** while generalizing workflow suspension under **WAITING**.
- Keep **WorkflowRun** separate from **Run**; only **AGENT** nodes create
  child Runs.
- Document fail-fast failure, idempotency, retries, cancellation targets,
  versioning, and OSVA determinism without event-history replay.

## Non-goals (Stage 3.2)

Stage 3.2 owns **semantics and contracts only**. It does **not** implement:

- PostgreSQL wait or event persistence
- Timer claiming, wakeup loops, or distributed timer processing
- Event matching transactions or orchestrator crash recovery beyond what
  already exists for V2
- HTTP APIs for event ingestion (beyond documenting conceptual behavior)
- WorkflowWait / WorkflowEvent PostgreSQL persistence (domain rehydration is
  ready; repositories are Stage 3.3)

Deferred explicitly (future or out of scope for OSS stable v1):

- Temporal / Inngest adapters as public workflow models
- Kafka or generic event brokers as OSVA lifecycle authority
- Dynamic DAG mutation, loops, SUBWORKFLOW
- Saga / compensation DSL
- ANY / N-of-M / quorum JOIN policies
- Wildcard or predicate event subscriptions; consume-style event queues
- Arbitrary expression languages for branch or wait matching
- Visual workflow builder concepts
- Streaming workflow state as product truth
- Enterprise governance layers
- Distributed workflow locks as a public product concept
- TOOL, RULE, HUMAN_TASK workflow node types
- Separate EXTERNAL_EVENT workflow node type (EVENT wait covers this)
- Workflow migration of in-flight executions across definition versions
- Workflow-level retry DSL
- Timeout branches on event waits
- Converting `ApprovalRequest` into `WorkflowEvent`

## Relationship to current repository behavior

| Area | After Pass 3.2.2 | Still Stage 3.2+ target |
|------|------------------|-------------------------|
| Executable definition schemas | `"1"`, `"2"` execute; `"3"` validate + persist only | WAIT execution on V3 |
| Orchestration node types (executable) | AGENT, BRANCH, PARALLEL, JOIN, APPROVAL on V2 | WAIT on V3 |
| WorkflowRun / node suspension | `WAITING` (approval uses it today) | EVENT/DURATION waits |
| Terminal WorkflowRun | SUCCEEDED, FAILED, **CANCELLED** (state only) | Cancellation API/propagation |
| Wait / event durability | Not implemented | Stage 3.3+ |
| `WorkflowWait` / `WorkflowEvent` entities | Pure domain + rehydration (3.2.4–3.2.6) | PostgreSQL + ingestion API |

Reconciliation today is implemented in
`packages/orchestration/src/reconcile-workflow-run.ts` for V1/V2 only. This
document does not claim WAIT or generic WAITING behavior is live.

## Conceptual execution model

OSVA workflow execution is **durable orchestration** over an immutable
**WorkflowVersion** graph, materialized as a **WorkflowRun** and per-node
**WorkflowNodeRun** rows. PostgreSQL is lifecycle authority. BullMQ transports
**RunAttempt** jobs for **AGENT** child Runs only; it is not the workflow state
machine.

```text
WorkflowVersion (immutable)
  → WorkflowRun (orchestration aggregate; pins one WorkflowVersion)
  → WorkflowNodeRun (per-node durable record)
       AGENT     → optional child Run / RunAttempt (executable work)
       BRANCH    → orchestration only; persisted route selection
       PARALLEL  → orchestration only; fan-out copy
       JOIN      → orchestration only; fan-in aggregate
       APPROVAL  → orchestration only; ApprovalRequest gate
       WAIT      → orchestration only; WorkflowWait suspension metadata
```

**WorkflowRun** represents workflow progression. **Run** represents executable
agent lifecycle. Do **not** create Runs or RunAttempts for BRANCH, PARALLEL,
JOIN, WAIT, or APPROVAL.

Human approval remains workflow state backed by **ApprovalRequest**; it is not
tool-call authorization and must not be modeled as a BullMQ wait job.

No worker, process, or container stays alive solely because a workflow is
waiting on duration, absolute time, or external event.

## Entity ownership

| Entity | Owner | Role |
|--------|-------|------|
| Workflow / WorkflowVersion | OSVA control plane | Immutable definition; graph + bindings |
| WorkflowRun | Domain + PostgreSQL | Orchestration execution aggregate |
| WorkflowNodeRun | Domain + PostgreSQL | Durable per-node state; canonical wait/resume identity |
| WorkflowWait | Domain (Pass 3.2.4–3.2.6) | Suspension metadata 1:1 with WorkflowNodeRun; **no WorkflowWaitId**; `rehydrate` for Stage 3.3 |
| WorkflowEvent | Domain (Pass 3.2.5A–3.2.6) | Immutable workspace-scoped external fact; `rehydrate` for Stage 3.3 |
| Run / RunAttempt | Domain + PostgreSQL | AGENT executable work only |
| ApprovalRequest | Domain + PostgreSQL | Human gate for APPROVAL nodes |
| Queue / scheduler job IDs | BullMQ / scheduler adapters | Transport only; not workflow product identity |

Resume identity for any wait is **WorkflowNodeRunId**. A wait must not
introduce a second workflow execution lifecycle or a generic public “resume
API” product object beyond existing reconciliation and (future) event/timer
drivers.

Durable workflow engines (see ADR-004) are **adapters** and must not define
OSVA’s public workflow model.

## Stable state machines (target)

### WorkflowRun

States:

```text
PENDING
RUNNING
WAITING
SUCCEEDED
FAILED
CANCELLED
```

Terminal: `SUCCEEDED`, `FAILED`, `CANCELLED`.

**WAITING** means no currently active node can make progress without an
external condition (timer, external event, or human approval decision). If
parallel work still has an AGENT Run in progress, the workflow remains
**RUNNING** even if another branch is armed on a duration or event wait.

Example: branch A on a 24h DURATION wait, branch B with a running AGENT →
`WorkflowRun` stays **RUNNING**. When B is no longer independently progressing
and only wait conditions remain → **WAITING**.

Pre–Pass 3.2.2 code used **`WAITING_FOR_APPROVAL`**; migration
`0017_workflow_waiting_state` rewrites persisted rows to **`WAITING`**. Only
approval blocking uses `WAITING` in production until WAIT nodes land.

### WorkflowNodeRun

States:

```text
PENDING
RUNNING
WAITING
SUCCEEDED
FAILED
SKIPPED
CANCELLED
```

Terminal: `SUCCEEDED`, `FAILED`, `SKIPPED`, `CANCELLED`.

Typical paths:

- **AGENT:** `PENDING → RUNNING → SUCCEEDED | FAILED | CANCELLED`
- **WAIT / APPROVAL:** `PENDING → WAITING → SUCCEEDED | FAILED | CANCELLED`
- **BRANCH / PARALLEL / JOIN:** orchestration transitions without RUNNING
  agent work (exact pre-success paths remain implementation detail; terminal
  outcomes are as today for V2 nodes)
- **SKIPPED:** inactive branch paths and propagated skips (unchanged V2 model)

State machine changes for **`WAITING`** and **`CANCELLED`** are implemented in
Pass 3.2.2. Cancellation **commands** are not.

## WorkflowWait (domain)

A **WorkflowWait** is suspension metadata associated **1:1** with a
**WorkflowNodeRun**. There is **no** independent `WorkflowWaitId`.

**Pass 3.2.4–3.2.6** implement pure domain arming, resolution, matching, and
`WorkflowWait.rehydrate` in `packages/domain/src/workflow-wait.ts`. PostgreSQL
persistence is Stage 3.3.

EVENT waits set **`eligibleFrom = WorkflowRun.createdAt`** (not `armedAt`) so
events received after the run starts but before the WAIT node arms may still
match later. Full matching uses `WorkflowEvent.receivedAt >= eligibleFrom` (and
`<= expiresAt` when configured); event ingestion is not implemented until Pass
3.2.5.

### APPROVAL vs WAIT (final Stage 3.2 architecture)

These paths share orchestration suspension vocabulary only. They do **not**
share a domain record.

```text
APPROVAL node  → ApprovalRequest (human decision; first-class approval state)
WAIT node      → WorkflowWait (TIMER or EVENT frozen criteria)
WorkflowEvent  → independently ingested immutable fact (not approval)
```

- Do **not** create `WorkflowWait` rows for APPROVAL nodes.
- Do **not** model approval decisions as `WorkflowEvent`.
- Do **not** merge `ApprovalRequest` into `WorkflowWait` (no dual source of
  truth for approval).

Both may set `WorkflowNodeRun.status = WAITING` and may contribute to
`WorkflowRun.status = WAITING`. Production approval behavior is unchanged.

Canonical resume identity: **WorkflowNodeRunId**.

Conceptual fields (storage-agnostic):

| Field | Notes |
|-------|--------|
| workspaceId | Scope |
| workflowRunId | Parent orchestration run |
| workflowNodeRunId | **Canonical wait identity** |
| kind | `DURATION` \| `UNTIL` \| `EVENT` (and approval-backed wait for APPROVAL nodes uses ApprovalRequest, not a separate kind in the definition) |
| armedAt | Authoritative activation instant; frozen at arm time |
| wakeAt | For DURATION and UNTIL when relevant; frozen |
| expiresAt | For EVENT timeout when configured; frozen at arm time |
| eventSource / eventType / correlationKey | For EVENT waits; frozen at arm time |
| approvalRequestId | For APPROVAL node waits when relevant |
| resolvedAt | When the wait completed |
| resolution | e.g. satisfied, timed out, cancelled, approved, rejected |
| resolvedByEventId | When an event satisfied an EVENT wait |

A wait resolves **at most once**. First durable matching resolution wins.
Duplicate scheduler or resume delivery after resolution is a no-op.

## WAIT node semantics (target, V3)

WAIT is the **single** suspension node type. Variants:

| Variant | Behavior summary |
|---------|------------------|
| **DURATION** | `armedAt` + configured duration → frozen `wakeAt`; resolve at or after `wakeAt` |
| **UNTIL** | Absolute RFC3339 instant; normalize to absolute instant; may complete immediately if already past |
| **EVENT** | Arm with frozen source, type, correlationKey, optional timeout |

WAIT nodes are **pass-through:** `output = input`.

Activation must **not** repeatedly compute `now + duration` during
reconciliation. DURATION and UNTIL deadlines are frozen when the wait arms.

### EVENT wait timeout

Optional timeout frozen at arm time as `expiresAt`. On timeout:

- WorkflowNodeRun → **FAILED**
- Domain error code: **`WORKFLOW_EVENT_TIMEOUT`**
- Workflow remains **fail-fast** (no timeout branch in v3)

### Event versus timeout race

Correctness uses OSVA **`receivedAt`** on the durable **WorkflowEvent** record.

- An event durably received at or before `expiresAt` is eligible to satisfy the
  wait (subject to exact match rules).
- An event received **after** `expiresAt` cannot satisfy the wait, even if
  producer-supplied `occurredAt` claims an earlier time.
- External `occurredAt` is informational; it must never alone determine
  correctness.

## WorkflowEvent (domain)

**Pass 3.2.5A** implements the immutable domain entity in
`packages/domain/src/workflow-event.ts`. **Pass 3.2.5B** implements matching,
eligibility, selection, and EVENT resolution helpers in
`packages/domain/src/workflow-wait-event.ts` and `WorkflowWait.resolveEvent`.
Ingestion APIs and PostgreSQL storage are **not** implemented yet.

| Field | Notes |
|-------|--------|
| id | **WorkflowEventId** (product identity for the observed fact) |
| workspaceId | Scope |
| source | Producer namespace (opaque non-empty string) |
| eventType | Exact-match type string |
| correlationKey | Opaque string; no trim/normalization |
| idempotencyKey | Producer-scoped ingestion identity component |
| payload | Canonical JSON value |
| occurredAt | Optional producer timestamp; **not** trusted for correctness |
| receivedAt | **OSVA authoritative** ingestion instant (no separate product `createdAt`) |

**Ingestion uniqueness:** `workspaceId + source + idempotencyKey`.

**Equivalent retry:** same ingestion identity and same semantic content
(`eventType`, `correlationKey`, payload, `occurredAt` presence/value) →
idempotent; conflicting content → `WorkflowEventIdempotencyConflictError`.
Retries must reuse the original `WorkflowEventId` and `receivedAt` (application
layer responsibility). `receivedAt` is authoritative for wait eligibility, not
`occurredAt`. `occurredAt` may be before or after `receivedAt`.

**Retention:** automatic event GC/TTL is deferred for OSS 1.0. Events that may
still satisfy a non-terminal workflow (including early events before a WAIT
arms) must not be deleted merely because matching has not happened yet.

Observe semantics (one event may satisfy multiple waits) are implemented in the
pure domain layer; consume-style queues remain out of scope.

## Event matching (implemented in domain, Pass 3.2.5B)

**Exact match only** (`matchesWorkflowEventWait`) on:

```text
workspaceId + source + eventType + correlationKey
```

Case-sensitive; payload, idempotencyKey, `WorkflowEventId`, `occurredAt`, and
`receivedAt` are **not** part of the criteria match. No wildcards, regex,
arbitrary predicates, or expression language.

**Eligibility** (`isWorkflowEventEligibleForWait`) requires criteria match and:

- `event.receivedAt >= wait.eligibleFrom` (inclusive; `eligibleFrom` is
  **WorkflowRun.createdAt**, not `armedAt` — early events before the WAIT arms
  may still satisfy the wait)
- `event.receivedAt <= now` at the decision instant
- when `wait.expiresAt` exists: `event.receivedAt <= expiresAt` (inclusive at
  `expiresAt`; late receipt after `expiresAt` is never eligible; `occurredAt`
  does not affect eligibility)

**Deterministic selection** (`selectWorkflowEventForWait`) among eligible
events: ascending `receivedAt`, then ascending lexical `WorkflowEventId` tie-break.
Independent of input array order, query order, or `occurredAt`.

**Event vs timeout** (`decideWorkflowEventWait`):

1. If any eligible event exists → **EVENT** (even when `now > expiresAt` but the
   event was received on time).
2. Else if `expiresAt` exists and `now >= expiresAt` → **TIMEOUT**.
3. Else → **PENDING** (no `expiresAt` → PENDING until an eligible event).

Orchestration should call `decideWorkflowEventWait`, then `resolveEvent` or
`resolveTimeout` accordingly. `resolveTimeout` must not run while an eligible
event exists.

**EVENT WorkflowWait resolution:** `resolution === "EVENT"` with
`resolvedByEventId` present if and only if resolution is EVENT;
`resolvedAt` is the OSVA wait-resolution instant (not event receipt). Event
payload is not copied onto the wait.

**Observe semantics:** one ingested **WorkflowEvent** **may** satisfy multiple
independently armed matching waits. OSVA does **not** define broker-style
**consume** semantics (no exclusive dequeue that hides an event from other
waits).

Durability and orchestration wiring remain Stage 3.3+.

## Correlation model (target, V3 definition)

Workflow Definition v3 supports a small deterministic reference model for
**EVENT** wait correlation, resolved when the WAIT node **arms**:

| Model | Meaning |
|-------|---------|
| **LITERAL** | Fixed opaque string in the definition |
| **INPUT_POINTER** | RFC 6901 JSON Pointer into WAIT node input; must resolve to a **string** |

The orchestrator **resolves and freezes** the actual `correlationKey` at arm
time. It must **not** reevaluate the pointer on later reconciliation passes.

Invalid pointer or non-string resolved value fails the WAIT node (fail-fast),
consistent with v3 error handling (exact code left to implementation pass).

## Branch semantics (unchanged from V2)

Preserve existing V2 behavior:

- Deterministic selector via RFC 6901 JSON Pointer
- Cases match **exact primitive equality** (`string`, `number`, `boolean`,
  `null`)
- Mandatory **defaultTo** route
- **selectedTargetKey** persisted on WorkflowNodeRun
- Inactive routes become durable **SKIPPED** with propagation
- BRANCH input passes through unchanged to selected successors
- No expression engine

## PARALLEL / JOIN semantics (unchanged from V2, explicit ALL)

**PARALLEL:** copies predecessor output unchanged to every outgoing active
successor.

**JOIN:** v3 supports join policy **ALL** only (implicit or explicit in
definition). JOIN waits for all **active** predecessors to become terminal.

- Any **failed** active predecessor → workflow fail-fast
- All predecessors **SKIPPED** → JOIN **SKIPPED**
- Otherwise JOIN **SUCCEEDS**
- JOIN input keyed deterministically by predecessor node key in **WorkflowVersion
  definition order**; only **SUCCEEDED** predecessors contribute values
- **`JOIN.output = JOIN.input`**

No ANY, quorum, race, or N-of-M join in v3.

## Approval semantics (unchanged; separate from WorkflowWait)

Preserve **ApprovalRequest** semantics:

```text
PENDING → APPROVED
PENDING → REJECTED
```

Repeated identical decision → idempotent. Conflicting second decision → fail.
First durable decision wins.

On rejection: APPROVAL node and WorkflowRun fail with **`APPROVAL_REJECTED`**
(existing code). Approval participates in generic **WAITING** workflow semantics
later; do **not** convert ApprovalRequest into WorkflowEvent.

## Failure semantics (target, fail-fast)

Stable v3 remains **fail-fast**:

| Condition | Workflow outcome |
|-----------|-------------------|
| Active AGENT failure | Workflow **FAILED** |
| Approval rejection | Workflow **FAILED** (`APPROVAL_REJECTED`) |
| EVENT wait timeout | Workflow **FAILED** (`WORKFLOW_EVENT_TIMEOUT`) |

Sibling Runs already executing may finish; their success **cannot** resurrect
a terminal workflow. No workflow-level retry DSL in Stage 3.2.

## Retry semantics

| Layer | Rule |
|-------|------|
| AGENT logical retry | Same **Run**, new **RunAttempt** |
| Queue redelivery | Same **RunAttemptId** |
| Orchestration reconciliation retry | Infrastructure retry; **no** RunAttempt |
| WAIT / BRANCH / PARALLEL / JOIN / APPROVAL | **No** RunAttempts |

## Cancellation (semantic lock; orchestration not implemented)

**WorkflowRun:** `CANCELLED` is terminal (no further transitions).

**WorkflowNodeRun:** `CANCELLED` is terminal alongside `SUCCEEDED`, `FAILED`,
`SKIPPED`.

**WorkflowWait:** `CANCELLED` is a terminal resolution; no conflicting
resolution may replace an existing resolution.

**WorkflowEvent:** immutable forever.

When Stage 3.3+ eventually cancels a workflow (command/API not in 3.2):

- **WorkflowRun** becomes **CANCELLED**.
- Non-terminal **WorkflowNodeRun** rows must not progress further.
- Active **WorkflowWait** rows become **CANCELLED** (or equivalent durable
  inactive semantics) in the same durable cancellation process.
- Late timer, event, or approval activity must not resurrect workflow progress.
- Already terminal node runs remain terminal.
- Child **Runs** already executing may finish independently; correctness does
  not require killing child processes; late child success cannot resurrect the
  **WorkflowRun**.

## Workflow evolution and versioning

- Every **WorkflowRun** permanently pins **exactly one** immutable
  **WorkflowVersion**.
- Publishing WorkflowVersion N+1 has **zero** semantic effect on runs started
  against N.
- Never re-resolve “current”, “latest”, or “active” workflow version during
  execution.
- Legacy V1/V2 definitions must not be mutated in place into V3.
- Compatibility path: stored immutable definition → version-aware
  decoder/validator → common internal workflow graph semantics.

## Determinism (OSVA definition)

OSVA does **not** require Temporal-style **replay determinism** or event
history replay.

For OSVA, **deterministic orchestration** means the same persisted state leads
to the same orchestration decision, given:

- Immutable WorkflowVersion pinned on the run
- Frozen effective execution bindings on child Runs
- Persisted branch selection (`selectedTargetKey`)
- Frozen wait criteria and deadlines at arm time
- Stable predecessor ordering (definition order)
- Durable node state transitions
- Deterministic idempotency identities
- Terminal workflow states cannot be resurrected

## Security invariants (closure)

- All workflow and event data is **workspace-scoped**; matching always includes
  `workspaceId`.
- **WorkflowEvent** fields from external producers (`source`, `eventType`,
  `correlationKey`, `idempotencyKey`, `payload`, `occurredAt`) are **untrusted**.
  Future ingestion APIs/adapters must enforce bounded lengths and payload sizes.
- Default logging must **not** emit: event `payload`, `correlationKey`, workflow
  input, or workflow output. Safe identifiers include: `workflowRunId`,
  `workflowNodeRunId`, `WorkflowEventId`, wait kind, `eventSource`, `eventType`,
  resolution. Treat `correlationKey` as an identifier (not a secret) but still
  omit from default logs (may embed customer IDs).
- Prompts and workflow titles/descriptions cannot grant tool permissions
  (unchanged platform rule).
- Secrets remain references, not plaintext in definitions.

## Observability expectations (target semantic events; not implemented in 3.2)

Suggested events/spans: `workflow.wait.armed`, `workflow.wait.resolved`,
`workflow.wait.timed_out`, `workflow.wait.cancelled`, `workflow.event.received`,
`workflow.event.duplicate`, `workflow.event.matched`, `workflow.resumed`.

Suggested dimensions: `workflowRunId`, `workflowVersionId`, `workflowNodeRunId`,
`nodeKey`, `waitKind`, `eventSource`, `eventType`, `eventId`, `resolution`.

Suggested metrics: `active_workflow_waits`, `workflow_wait_duration`,
`event_match_latency`, `event_to_resume_latency`, `workflow_event_duplicates`,
`workflow_wait_timeouts`.

OpenTelemetry remains auxiliary; export failure must not change lifecycle
authority.

## V3 execution enablement gate (not satisfied; do not add `"3"` yet)

`WORKFLOW_EXECUTABLE_DEFINITION_SCHEMA_VERSIONS` may include `"3"` only after
Stage 3.3+ delivers at minimum:

1. Durable **WorkflowWait** persistence (one row per `WorkflowNodeRunId`)
2. Durable **WorkflowEvent** persistence
3. Atomic/idempotent WAIT arming
4. TIMER due discovery (`wakeAt` indexing)
5. EVENT candidate lookup (exact match + `receivedAt` window)
6. Deterministic `decideWorkflowEventWait` before timeout commit
7. Atomic at-most-once wait resolution
8. WAIT **WorkflowNodeRun** transition to `SUCCEEDED` / `FAILED`
9. Workflow reconciliation after wait resolution
10. Recovery after process crash
11. Multiple orchestrator safety
12. Terminal/cancellation resurrection protection

Until then, `assertWorkflowDefinitionExecutable` and reconciler guards remain.

## Stage 3.3 persistence contract (handoff; no SQL in 3.2)

**WorkflowWait**

- Uniqueness: one durable wait per **WorkflowNodeRun**; canonical identity =
  `workflowNodeRunId` (no `WorkflowWaitId`).
- Persist frozen execution criteria only (see `WorkflowWait.rehydrate` props).
- TIMER discovery: unresolved TIMER waits indexed/ordered by `wakeAt`.
- EVENT timeout discovery: unresolved EVENT waits with `expiresAt`.

**WorkflowEvent**

- Ingestion uniqueness: `workspaceId + source + idempotencyKey`.
- Matching index conceptually needs: `workspaceId`, `source`, `eventType`,
  `correlationKey`, `receivedAt`.

Repositories load primitives → `rehydrate(...)` → immutable domain objects.

## Stage 3.3 concurrency requirements (documented; not implemented)

- Wait arming: idempotent (no duplicate active wait per node).
- TIMER / EVENT resolution: at most one durable resolution wins.
- TIMEOUT race: commit path must verify no eligible event exists (use
  `decideWorkflowEventWait` ordering).
- Multiple orchestrators: no duplicate **WorkflowNodeRun** progression.
- Crash after resolution before successor materialization: reconciliation
  resumes from persisted resolved wait + node state.
- Queue delivery IDs and scheduler delivery IDs are **not** workflow product
  identity.

## Crash recovery scenarios (Stage 3.3 expectations)

| Scenario | Expected recovery |
|----------|-------------------|
| A. Wait persisted before orchestrator returns | Reconciliation sees active wait; do not arm again |
| B. Wait resolved before node succeeds | Reconciliation sees resolved wait; continue node progression; do not re-resolve |
| C. Node succeeded before successor materialized | Reconciliation derives ready successor and continues |
| D. Duplicate timer delivery | No duplicate logical resolution |
| E. Duplicate event processing | No duplicate logical resolution |

## Stage 3.2 vs Stage 3.3 boundary

| **Implemented in Stage 3.2 (domain + docs)** | **Stage 3.3+ target** |
|---------------------------------------------|------------------------|
| V3 definition validation; V3 runs blocked | V3 execution when enablement gate passes |
| `WorkflowWait` / `WorkflowEvent` + matching semantics | PostgreSQL tables + repositories |
| `rehydrate` + persisted-state invariants | Load/save in orchestration |
| APPROVAL vs WAIT architecture lock | WAIT reconciliation in production |
| Cancellation / security / observability semantics | APIs, timers, event ingest, crash-safe orchestration |

## Planned implementation passes (informative)

Exact numbering may shift; dependencies flow top-down:

1. **3.2.1** — Semantics docs + `WORKFLOW_DEFINITION_V3.md` + AGENTS invariants.
2. **3.2.2** — Lifecycle generalization (`WAITING`, `CANCELLED` state model) **done**.
3. **3.2.3** — `schemaVersion: "3"` contract + validation; block V3 runs **done**.
4. **3.2.4** — Pure `WorkflowWait` arming/resolution domain **done**.
5. **3.2.5A** — `WorkflowEvent` domain + ingestion idempotency **done**.
6. **3.2.5B** — Event-to-wait matching rules in domain **done**.
7. **3.2.6** — Rehydration, invariant closure, Stage 3.3 handoff **done**.
8. **3.3.x** — Persistence, event API, timer infrastructure, WAIT
   reconciliation, enable V3 execution when gate satisfied.

Subsequent passes must not redesign the model frozen here.

## References

- [`WORKFLOW_DEFINITION_V1.md`](../contracts/WORKFLOW_DEFINITION_V1.md)
- [`WORKFLOW_DEFINITION_V2.md`](../contracts/WORKFLOW_DEFINITION_V2.md)
- [`WORKFLOW_DEFINITION_V3.md`](../contracts/WORKFLOW_DEFINITION_V3.md)
- [`ADR-004-durable-workflow-backend.md`](../adr/ADR-004-durable-workflow-backend.md)
- [`workflow-execution.md`](../architecture/flows/workflow-execution.md) (current V1/V2 flow)
- [`EXECUTION_AND_WORKFLOWS.md`](../platform/EXECUTION_AND_WORKFLOWS.md)
