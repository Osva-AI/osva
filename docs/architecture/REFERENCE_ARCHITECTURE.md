# Reference Architecture

```text
┌──────────────────────────────────────────────┐
│ Experience: Web · API · CLI · SDK           │
├──────────────────────────────────────────────┤
│ Control Plane                               │
│ Agents · Workflows · Tools · Models · Evals │
├──────────────────────────────────────────────┤
│ Orchestration                               │
│ Runs · Scheduler · Queue · Approvals        │
├──────────────────────────────────────────────┤
│ Execution                                   │
│ ExecutionWorkers · RuntimeAdapters          │
├──────────────────────────────────────────────┤
│ Intelligence                                │
│ ModelGateway · ToolGateway · Memory         │
├──────────────────────────────────────────────┤
│ Quality                                     │
│ Logs · Usage · Cost · Evaluation            │
├──────────────────────────────────────────────┤
│ Infrastructure Ports                        │
│ DB · Queue · Storage · Secrets · Telemetry  │
└──────────────────────────────────────────────┘
```

## Control plane

Owns durable intent and configuration.

## Orchestration

Creates Runs and WorkflowRuns, manages state, dispatches work, and coordinates waits.

## Execution

Runs Agent code through RuntimeAdapters on ExecutionWorkers.

## Intelligence

Normalizes model, Tool, memory, and knowledge access.

## Quality

Stores canonical operational and evaluation state.

## Infrastructure

Concrete databases, queues, object stores, secret stores, and telemetry systems remain adapters.
