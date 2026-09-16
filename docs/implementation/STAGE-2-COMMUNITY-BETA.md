# Stage 2 Community Beta

## Build

- ✅ Slice 2.1: versioned sequential Workflow execution
  (`Workflow` / immutable `WorkflowVersion` / `WorkflowRun` /
  `WorkflowNodeRun`, linear AGENT graphs, durable PostgreSQL
  reconciliation, child Runs through the existing execution path);
- ✅ Slice 2.2: branch/parallel/join DAG orchestration
  (`schemaVersion: "2"`, durable `SKIPPED`, skip propagation,
  concurrent ready AGENT nodes, process-level workflow-orchestrator E2E);
- ✅ Slice 2.3: multi-agent composition and durable APPROVAL
  (different AGENT nodes bind different immutable AgentVersions; human
  approval is a workflow orchestration primitive with ApprovalRequest;
  no direct agent-to-agent runtime API);
- Node SDK;
- Python SDK;
- HTTP runtime;
- additional providers;
- MCP client;
- connectors;
- memory namespaces;
- OpenTelemetry;
- CLI/public SDK;
- EvaluationSuites;
- basic AI Office entities.

Workflow Definition remains pre-1.0 but versioned.

## Slice 2.1

Stage 2.1 adds the smallest durable workflow kernel:

```text
Workflow
  → immutable WorkflowVersion
  → WorkflowRun
  → sequential WorkflowNodeRuns
  → canonical child Run
  → canonical RunAttempt
  → existing BullMQ / ExecutionWorker path
```

Sequential data flow is:

```text
WorkflowRun.input → first node input
node N output → node N+1 input
final node output → WorkflowRun.output
```

PostgreSQL is workflow lifecycle authority. `apps/workflow-orchestrator`
reconciles persisted WorkflowRun state. BullMQ transports child RunAttempts
and is not the workflow state machine.

Slice 2.1 does not implement branches, parallel execution, approvals,
expression languages, workflow retries, TOOL/HTTP/MCP nodes, or a visual
builder.

## Slice 2.2

Stage 2.2 upgrades the sequential reconciler into a durable DAG reconciler
without replacing the Stage 2.1 architecture:

```text
persisted PostgreSQL state
  → derive ready / skippable / failed nodes
  → idempotent WorkflowNodeRun transitions
  → canonical child Runs for AGENT nodes only
  → persist results
  → reconcile again
```

V1 sequential definitions remain executable. V2 adds `BRANCH`, `PARALLEL`,
and `JOIN`. Only AGENT nodes create canonical Runs. Inactive branch paths
are durably `SKIPPED`. JOIN aggregates succeeded predecessors by node key
in definition order. Fail-fast workflow failure does not cancel in-flight
sibling Runs and cannot be overwritten by later sibling success.

Slice 2.2 does not implement approvals, pause/resume, cancellation,
workflow retries, loops, expression languages, TOOL/HTTP/MCP nodes, or a
visual builder.

## Slice 2.3

Stage 2.3 formalizes OSVA multi-agent behavior as workflow composition and
adds a durable `APPROVAL` orchestration node.

Different AGENT nodes on one immutable WorkflowVersion may reference
different immutable AgentVersions. Handoff, routing, fan-out, fan-in, and
human gates happen only through WorkflowRun / WorkflowNodeRun. The trusted
runtime does not expose agent invocation, spawning, or messaging APIs.

When an APPROVAL node is ready, PostgreSQL records one ApprovalRequest and
the WorkflowNodeRun becomes `WAITING_FOR_APPROVAL`. BullMQ is not used as
the waiting mechanism. Humans decide through
`POST /v1/approval-requests/:id/decision`. The API persists `APPROVED` or
`REJECTED` only; `apps/workflow-orchestrator` reconciles the decision.
Approved nodes pass input through unchanged. Rejected nodes fail the
WorkflowRun with `APPROVAL_REJECTED`. `WAITING_FOR_APPROVAL` on the
WorkflowRun means human input is the actual remaining blocker.

`decidedBy` is omitted because OSVA has no durable principal identity yet.

Slice 2.3 does not implement approval expiration, assignment, quorum,
rejection branches, revision loops, tool-call approval, Node/Python/HTTP
runtimes, MCP, or a visual builder.
