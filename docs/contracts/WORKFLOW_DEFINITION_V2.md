# Workflow Definition v2

**Status:** Pre-1.0 contract

Slice 2.2 added an immutable DAG schema for WorkflowVersion definitions.
Slice 2.3 adds `APPROVAL` on the same `schemaVersion: "2"` contract.
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

V2 supports these node types:

- `AGENT` — the only executable agent node. It references an immutable
  `agentVersionId` and creates one canonical child Run.
- `BRANCH` — deterministic route selection. OSVA orchestration state only.
- `PARALLEL` — explicit fan-out. OSVA orchestration state only.
- `JOIN` — explicit fan-in. OSVA orchestration state only.
- `APPROVAL` — durable human gate. OSVA orchestration state only.

`BRANCH`, `PARALLEL`, `JOIN`, and `APPROVAL` never create Runs, RunAttempts,
or invoke agent, model, tool, or runtime code.

Different AGENT nodes may bind different immutable AgentVersions. Multi-agent
execution is therefore workflow composition: sequential handoff, branch
routing, parallel agents, JOIN aggregation, and human approval gates. Agents
cannot directly create another agent execution. There is no agent-to-agent
invoke API, messaging bus, or multi-agent session abstraction.

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
- `APPROVAL`: incoming 0 iff entry, else 1; outgoing 0 iff terminal, else 1
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

## APPROVAL

APPROVAL is a pass-through human gate, not a BRANCH.

```json
{
  "key": "launch-review",
  "type": "APPROVAL",
  "title": "Approve campaign launch",
  "description": "Review the proposed campaign before publishing."
}
```

`title` is required, non-empty, and at most 200 characters. `description` is
optional, non-empty when present, and at most 2000 characters. Titles and
descriptions are literal; there is no interpolation, JSONPath, or
node-output templating.

When an APPROVAL node becomes ready, the reconciler materializes one
WorkflowNodeRun, transitions it to `WAITING`, and creates
exactly one `ApprovalRequest`. It does not enqueue BullMQ work.

`APPROVAL.input` is the predecessor output. On approval,
`APPROVAL.output = APPROVAL.input`. The successor receives that exact value.

An ApprovalRequest is a first-class workspace-scoped record:

```text
PENDING → APPROVED
PENDING → REJECTED
```

Decisions are immutable. Repeating the same decision is idempotent.
Conflicting second decisions fail. Concurrent submitters are serialized by
PostgreSQL compare-and-set; the first durable decision wins.

The decision API (`POST /v1/approval-requests/:id/decision`) persists only
the decision. The workflow reconciler later observes `APPROVED` or
`REJECTED` and advances the WorkflowNodeRun. `APPROVED` continues the DAG.
`REJECTED` fails the APPROVAL node and the WorkflowRun with domain code
`APPROVAL_REJECTED`. Slice 2.3 does not implement rejection branches,
revision loops, expiration, assignment, or quorum.

`decidedBy` is omitted: OSVA does not yet have a durable authenticated
principal identity, and Slice 2.3 does not invent User/RBAC entities.

This is workflow-progression approval. It is not tool-call authorization and
does not change ToolGateway permission flow.

WorkflowRun becomes `WAITING` only when at least one APPROVAL
node is waiting and no non-approval work can make independent progress. A
parallel agent still running keeps WorkflowRun `RUNNING`.

Inactive APPROVAL paths are durably `SKIPPED` and do not create an
ApprovalRequest. Activation vs skip is compare-and-set: a node already
`WAITING` is not skipped.

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

If any active AGENT path fails, or an APPROVAL is rejected, `WorkflowRun`
becomes `FAILED`. Already started sibling Runs may finish; their completion
cannot resurrect a failed workflow. Cancellation, retries, loops, rejection
branches, approval expiration, and expression languages remain out of scope.

`WorkflowRun.output` remains the terminal node output.
