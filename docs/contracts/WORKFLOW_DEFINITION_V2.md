# Workflow Definition v2

**Status:** Pre-1.0 contract

Slice 2.2 adds an immutable DAG schema for WorkflowVersion definitions.
`schemaVersion: "1"` remains valid and executable. V2 does not change V1
semantics.

## Stored shape

```json
{
  "schemaVersion": "2",
  "nodes": [
    { "key": "a", "type": "AGENT", "agentVersionId": "agent-version-1" },
    { "key": "fanout", "type": "PARALLEL" },
    { "key": "b", "type": "AGENT", "agentVersionId": "agent-version-2" },
    { "key": "c", "type": "AGENT", "agentVersionId": "agent-version-3" },
    { "key": "join", "type": "JOIN" },
    { "key": "d", "type": "AGENT", "agentVersionId": "agent-version-4" }
  ],
  "edges": [
    { "from": "a", "to": "fanout" },
    { "from": "fanout", "to": "b" },
    { "from": "fanout", "to": "c" },
    { "from": "b", "to": "join" },
    { "from": "c", "to": "join" },
    { "from": "join", "to": "d" }
  ]
}
```

## Node types

Slice 2.2 supports exactly four node types:

- `AGENT` — the only executable agent node. It references an immutable
  `agentVersionId` and creates one canonical child Run.
- `BRANCH` — deterministic route selection. OSVA orchestration state only.
- `PARALLEL` — explicit fan-out. OSVA orchestration state only.
- `JOIN` — explicit fan-in. OSVA orchestration state only.

`BRANCH`, `PARALLEL`, and `JOIN` never create Runs, RunAttempts, or invoke
agent code.

## Topology

Global V2 rules:

- unique node keys
- edges reference existing nodes
- exactly one entry node and one terminal node
- acyclic
- every node reachable from entry
- every node can reach terminal
- AgentVersions exist in the same workspace
- no implicit fan-out except `BRANCH` and `PARALLEL`
- no implicit fan-in except `JOIN`

Node-type constraints:

- `AGENT`: incoming 0 iff entry, else 1; outgoing 0 iff terminal, else 1
- `PARALLEL`: incoming ≤ 1; outgoing ≥ 2
- `JOIN`: incoming ≥ 2; outgoing ≤ 1
- `BRANCH`: incoming ≤ 1; outgoing ≥ 2

## BRANCH

Selector is a JSON Pointer (RFC 6901). Cases match exact primitive values
(`string`, `number`, `boolean`, `null`). `defaultTo` is mandatory.

Missing selector values, non-primitive selector values, and unmatched values
select the default path. They do not fail the workflow.

The routing decision is persisted as `WorkflowNodeRun.selectedTargetKey`.
BRANCH does not transform business payload. Selected successors receive
`BRANCH.input` unchanged. Unselected outgoing routes become durable
`SKIPPED` WorkflowNodeRuns, and skip propagation continues until a node
whose readiness still depends on an active predecessor.

## PARALLEL

Receives predecessor output, succeeds as orchestration, and copies that
exact value to every outgoing successor. There is no mapping syntax. Fan-out
must later converge through an explicit `JOIN` if the workflow continues as
one path.

## JOIN

Slice 2.2 supports only join policy `ALL`. JOIN becomes resolvable when every
predecessor is terminal (`SUCCEEDED`, `SKIPPED`, or `FAILED`).

- any predecessor `FAILED` → workflow fail-fast
- all predecessors `SKIPPED` → JOIN is `SKIPPED` and skip continues
- otherwise JOIN succeeds
- JOIN input is keyed by predecessor node key in WorkflowVersion definition
  order and includes only `SUCCEEDED` predecessors
- `JOIN.output = JOIN.input`

## SKIPPED

`SKIPPED` is a durable WorkflowNodeRun status. Absence of a row is not used
as historical skip evidence.

## Execution model

DAG execution is derived from persisted PostgreSQL state. The reconciler
materializes ready nodes, resolves orchestration nodes, creates canonical
child Runs for AGENT nodes, and reconverges. Multiple ready AGENT nodes may
run concurrently. Multiple orchestrator instances are correctness-safe via
PostgreSQL uniqueness, compare-and-set transitions, and Run idempotency
keys of the form `workflow:${workflowRunId}:${workflowNodeKey}`.

If any active AGENT path fails, `WorkflowRun` becomes `FAILED`. Already
started sibling Runs may finish; their completion cannot resurrect a failed
workflow. Cancellation, approval, retries, loops, and expression languages
are out of scope for Slice 2.2.

`WorkflowRun.output` remains the terminal node output.
