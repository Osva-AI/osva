# Domain Model

## Agent

```text
Agent
  ├── AgentVersion*
  ├── Deployment*
  └── Run*
```

## Run

```text
Run
  ├── input (immutable execution snapshot)
  ├── RunAttempt*
  │    └── RunStep*
  ├── RunLog*
  ├── UsageRecord*
  ├── Artifact*
  └── EvaluationResult*
```

## Workflow

```text
Workflow
  ├── WorkflowVersion*
  └── WorkflowRun*
       └── WorkflowNodeRun*
            ├── canonical child Run (AGENT only)
            └── ApprovalRequest (APPROVAL only)
```

## Tool

```text
Tool
  ├── ToolVersion*
  └── ToolGrant*
```

## Model

```text
ModelProfile
  └── ModelProfileVersion*
```

A ModelProfile is a stable Workspace-owned identity. A ModelProfileVersion is
an immutable append-only snapshot of provider plus provider model ID. Agent
code never sees these IDs; it uses logical binding names declared on an
immutable AgentVersion and frozen onto the Run.

## Runtime

```text
RuntimeDefinition
ExecutionWorkerPool
ExecutionWorker
Deployment
```

## AI Office

```text
Office
Team
Role
OfficeWorker
Goal
Assignment
HumanTask
```

## Immutable execution binding

A Run or WorkflowRun persists effective immutable references before execution where they are statically knowable.

A Run owns the immutable JSON-compatible execution `input`. Retries and
reconstruction must reuse that captured input rather than resolving a
newer caller payload.

CreateRun also freezes AgentVersion model bindings into
`Run.effectiveBindings.modelProfileVersionBindings`. Runtime execution must
reuse that snapshot. Appending a newer ModelProfileVersion after the Run exists
must not change that Run.

Dynamic selection resolves once for the logical node/operation and remains fixed across retries.
