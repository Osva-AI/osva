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

Dynamic selection resolves once for the logical node/operation and remains fixed across retries.
