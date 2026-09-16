# Stage 2 Community Beta

## Build

- ✅ Slice 2.1: versioned sequential Workflow execution
  (`Workflow` / immutable `WorkflowVersion` / `WorkflowRun` /
  `WorkflowNodeRun`, linear AGENT graphs, durable PostgreSQL
  reconciliation, child Runs through the existing execution path);
- ✅ Slice 2.2: branch/parallel/join DAG orchestration
  (`schemaVersion: "2"`, durable `SKIPPED`, skip propagation,
  concurrent ready AGENT nodes, process-level workflow-orchestrator E2E);
- Node SDK;
- Python SDK;
- HTTP runtime;
- multi-agent composition;
- approval primitive;
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
