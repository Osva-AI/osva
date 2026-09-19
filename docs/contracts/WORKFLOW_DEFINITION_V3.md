# Workflow Definition v3 (Stable OSS Workflow Definition v1)

**Status:** Stage 3.2 **contract implemented** (Pass 3.2.3); **execution not enabled**

**Persisted field:** `"schemaVersion": "3"`

**Product milestone name:** Stable Workflow Definition v1 (OSS 1.0). The wire
schema version is **3**; do not conflate product naming with the persisted
`schemaVersion` string.

**Implemented (Pass 3.2.3):** `@osva/contracts` Zod schemas, domain graph
validation, WorkflowVersion persistence for valid V3 definitions.

**Not implemented:** V3 `WorkflowRun` creation, WAIT orchestration,
WorkflowWait / WorkflowEvent, timers, and event ingestion. Executable workflow
definitions remain `schemaVersion: "1"` and `"2"` only.

## Design principles

- Workflow definitions belong to **OSVA**; durable backends are adapters (ADR-004).
- **AGENT** is the only node type that creates a canonical **Run**.
- **BRANCH**, **PARALLEL**, **JOIN**, **APPROVAL**, and **WAIT** are
  orchestration nodes only.
- No TOOL, RULE, HUMAN_TASK, SUBWORKFLOW, loops, dynamic graph mutation,
  saga/compensation, or visual-builder concepts in v3.
- No separate **EXTERNAL_EVENT** node; **EVENT** is a WAIT variant.
- Fail-fast workflow failure (no workflow-level retry DSL in v3).

## Stored shape (conceptual)

```json
{
  "schemaVersion": "3",
  "nodes": [ "..." ],
  "edges": [
    { "from": "node-a", "to": "node-b" }
  ]
}
```

Edges match the V1/V2 model: directed edges between node keys.

## Supported node types (v3 only)

| Type | Creates Run | Summary |
|------|-------------|---------|
| `AGENT` | Yes | One immutable `agentVersionId`; one child Run when executed |
| `BRANCH` | No | Deterministic route selection (V2 semantics) |
| `PARALLEL` | No | Fan-out copy of input (V2 semantics) |
| `JOIN` | No | Fan-in with policy **ALL** only (V2 semantics) |
| `APPROVAL` | No | Human gate via ApprovalRequest (V2 semantics) |
| `WAIT` | No | Suspension: DURATION, UNTIL, or EVENT |

Conceptual node types such as `TOOL`, `RULE`, `HUMAN_TASK`, and `SUBWORKFLOW`
may appear in older documentation lists but are **not** valid in v3 definitions.

## Global topology rules

Inherit V2 global rules unless noted:

- Unique node keys
- Edges reference existing nodes
- Exactly one entry node and one terminal node
- Acyclic graph
- Every node reachable from entry; every node can reach terminal
- Referenced AgentVersions exist in the same workspace
- No implicit fan-out except `BRANCH` and `PARALLEL`
- No implicit fan-in except `JOIN`

### Per-type degree constraints

| Type | Incoming | Outgoing |
|------|----------|----------|
| `AGENT` | 0 iff entry, else 1 | 0 iff terminal, else 1 |
| `APPROVAL` | 0 iff entry, else 1 | 0 iff terminal, else 1 |
| `WAIT` | 0 iff entry, else 1 | 0 iff terminal, else 1 |
| `PARALLEL` | ≤ 1 | ≥ 2 |
| `JOIN` | ≥ 2 | ≤ 1 |
| `BRANCH` | ≤ 1 | ≥ 2 |

## AGENT

Same as V2:

```json
{
  "key": "research",
  "type": "AGENT",
  "agentVersionId": "agent-version-id"
}
```

Logical aliases (`latest`, `active`, `current`) are not supported. Definitions
bind to immutable **AgentVersion** ids, not bare Agent ids.

Child Runs freeze effective bindings through the existing **CreateRun** path.
Retries reuse those bindings per Run lifecycle rules.

## BRANCH

Same as V2:

```json
{
  "key": "route",
  "type": "BRANCH",
  "selector": "/status",
  "cases": [
    { "equals": "ok", "to": "success-path" },
    { "equals": "retry", "to": "retry-path" }
  ],
  "defaultTo": "fallback-path"
}
```

- `selector`: RFC 6901 JSON Pointer
- `cases[].equals`: primitive only (`string`, `number`, `boolean`, `null`)
- `defaultTo`: mandatory
- Persist `selectedTargetKey` on WorkflowNodeRun
- Unselected outgoing edges → durable **SKIPPED** with propagation
- Output to selected successors equals **BRANCH input** unchanged
- No expression engine

## PARALLEL

Same as V2:

```json
{ "key": "fanout", "type": "PARALLEL" }
```

Receives predecessor output, succeeds as orchestration, copies that exact value
to each outgoing active successor. Converge with an explicit downstream **JOIN**
when required.

## JOIN

V3 supports join policy **ALL** only.

```json
{ "key": "join", "type": "JOIN" }
```

V3 supports join policy **ALL** only. The persisted schema does not include a
`joinPolicy` field; **ALL** is implicit.

Semantics (unchanged from V2):

- Resolvable when every active predecessor is terminal
- Any active predecessor **FAILED** → workflow fail-fast
- All active predecessors **SKIPPED** → JOIN **SKIPPED**
- Otherwise JOIN **SUCCEEDS**
- JOIN input: object keyed by predecessor node key in **definition order**,
  values from **SUCCEEDED** predecessors only
- **`JOIN.output = JOIN.input`**

## APPROVAL

Same as V2:

```json
{
  "key": "launch-review",
  "type": "APPROVAL",
  "title": "Approve launch",
  "description": "Optional human-readable context."
}
```

- `title`: required, non-empty, max 200 characters
- `description`: optional, non-empty when present, max 2000 characters
- Literal strings only; no interpolation or templating

When ready, materialize one WorkflowNodeRun and one **ApprovalRequest**; do not
enqueue BullMQ work. On approval, **APPROVAL.output = APPROVAL.input**.
Rejection fails the node and WorkflowRun with **`APPROVAL_REJECTED`**.

Approval is **not** a WorkflowEvent. Stage 3.2 targets mapping approval
blocking into generic workflow **WAITING** at the WorkflowRun level in later
implementation passes.

## WAIT

New in v3. Single suspension node with exactly one variant:

```json
{
  "key": "wait-for-signal",
  "type": "WAIT",
  "wait": { "... variant ..." }
}
```

WAIT is pass-through: **`WAIT.output = WAIT.input`**.

Orchestration associates **WorkflowWait** metadata 1:1 with the
**WorkflowNodeRun** (see Stage 3.2 semantics doc). Resume identity is
**WorkflowNodeRunId**; there is no WorkflowWaitId.

### Variant: DURATION

```json
{
  "wait": {
    "kind": "DURATION",
    "durationMs": 86400000
  }
}
```

- `durationMs`: positive integer
- On arm: `armedAt` = authoritative activation instant;
  `wakeAt = armedAt + durationMs` (both frozen)
- Reconciliation must not recompute `now + durationMs`
- Resolve at or after `wakeAt`

### Variant: UNTIL

```json
{
  "wait": {
    "kind": "UNTIL",
    "until": "2026-12-31T23:59:59Z"
  }
}
```

- `until`: absolute instant in RFC3339 form (normalized semantics around one
  absolute instant)
- On arm: freeze `wakeAt` (or equivalent normalized instant)
- If `until` is already reached at activation, the node may complete
  immediately

### Variant: EVENT

```json
{
  "wait": {
    "kind": "EVENT",
    "source": "billing",
    "eventType": "payment.captured",
    "correlation": {
      "model": "INPUT_POINTER",
      "pointer": "/paymentId"
    },
    "timeoutMs": 3600000
  }
}
```

Required:

- `source`: non-empty string (producer namespace)
- `eventType`: non-empty string
- `correlation`: reference model (below)

Optional:

- `timeoutMs`: positive integer; frozen to `expiresAt` at arm time

On arm:

- Resolve `correlationKey` from `correlation` model
- Freeze `source`, `eventType`, `correlationKey`, `armedAt`, and `expiresAt`
  (if timeout configured)

Matching uses exact tuple:

```text
workspaceId + source + eventType + correlationKey
```

On timeout: node **FAILED**, error **`WORKFLOW_EVENT_TIMEOUT`**, workflow
fail-fast. Event–timeout races use OSVA **receivedAt** (see Stage 3.2 semantics).

### Correlation reference model

Only these models are valid in v3:

**LITERAL**

```json
{
  "model": "LITERAL",
  "value": "opaque-correlation-string"
}
```

**INPUT_POINTER**

```json
{
  "model": "INPUT_POINTER",
  "pointer": "/field/path"
}
```

- Pointer: RFC 6901 JSON Pointer against WAIT node **input**
- Resolved value must be a **string**
- Resolved `correlationKey` is frozen at arm time; no reevaluation on later
  reconciliation

## SKIPPED

Same durable meaning as V2: inactive branch paths and propagated skips. Absence
of a WorkflowNodeRun row is not historical skip evidence.

## Execution bindings and versioning

- Every **WorkflowRun** references exactly one immutable **WorkflowVersion**.
- Execution never resolves “latest” workflow version.
- V1 and V2 WorkflowVersions remain valid historical stored contracts.
- New stable OSS graphs use **`schemaVersion: "3"`**; do not mutate V1/V2 rows
  in place into V3.

## Relationship to Run / RunAttempt

| Node types | Run / RunAttempt |
|------------|------------------|
| AGENT | Creates exactly one canonical child Run (idempotency key pattern unchanged from V2) |
| BRANCH, PARALLEL, JOIN, APPROVAL, WAIT | **Never** create Runs or RunAttempts |

Queue job IDs and scheduler IDs are transport details, not workflow identity.

## Explicit non-goals in v3 schema

Not valid node types or definition features in v3:

- TOOL, RULE, HUMAN_TASK, SUBWORKFLOW
- Loops and dynamic DAG mutation
- Saga / compensation steps
- JOIN policies other than ALL
- Wildcard or predicate event subscriptions
- Timeout **branches** on EVENT waits (timeout fails the workflow)
- Expression languages for branch or wait matching
- Consume-style exclusive event queues

## Implementation status checklist

| Capability | Contract (this doc) | Current repo |
|------------|---------------------|--------------|
| `schemaVersion: "3"` persistence | Yes | Yes (validation on append) |
| `@osva/contracts` Zod for v3 | Yes | Yes |
| WAIT node in definition | Yes | Validated only |
| `CreateWorkflowRun` for V3 | Blocked until execution pass | Rejected (`WorkflowDefinitionNotExecutableError`) |
| WAIT node execution | Yes | No |
| WorkflowEvent ingest + match | Yes | No |
| `WorkflowWait` pure domain (Pass 3.2.4) | Yes | Arming + resolution only; not persisted |
| `WorkflowEvent` domain (Pass 3.2.5A) | Yes | Entity + ingest idempotency |
| Event/wait matching (Pass 3.2.5B) | Yes | Pure domain; ingest API + persistence pending |
| Wait/event rehydration (Pass 3.2.6) | Yes | Domain `rehydrate`; PostgreSQL Stage 3.3 |

See [`STAGE-3-2-WORKFLOW-SEMANTICS.md`](../implementation/STAGE-3-2-WORKFLOW-SEMANTICS.md)
for full orchestration semantics, idempotency, cancellation targets, and Stage
3.3 boundary.
