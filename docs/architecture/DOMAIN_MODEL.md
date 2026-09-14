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

Dynamic selection resolves once for the logical node/operation and remains fixed across retries.
