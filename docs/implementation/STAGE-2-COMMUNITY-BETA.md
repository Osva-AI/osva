# Stage 2 Community Beta

## Build

- ✅ Slice 2.1: versioned sequential Workflow execution
  (`Workflow` / immutable `WorkflowVersion` / `WorkflowRun` /
  `WorkflowNodeRun`, linear AGENT graphs, durable PostgreSQL
  reconciliation, child Runs through the existing execution path);
- Node SDK;
- Python SDK;
- HTTP runtime;
- branch/parallel nodes;
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
