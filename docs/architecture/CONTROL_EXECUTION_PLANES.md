# Control and Execution Planes

## Control plane

Owns:

- Agent Registry;
- AgentVersions;
- Workflow Registry;
- Tool Registry;
- ModelProfiles;
- schedules;
- evaluation definitions;
- policies;
- AI Office state.

## Execution plane

Owns:

- ExecutionWorker lifecycle;
- RuntimeAdapter invocation;
- model and Tool requests;
- execution events;
- output/artifact production.

## Rule

The control plane decides **what** should execute.

The execution plane performs **how** that immutable execution plan runs.
