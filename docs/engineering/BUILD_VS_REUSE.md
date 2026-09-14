# Build vs Reuse

## Build in OSVA

Own:

- Agent/AgentVersion;
- Run/RunAttempt/RunStep;
- Workflow definition;
- Runtime Protocol;
- Tool/ToolVersion semantics;
- ModelProfile abstraction;
- evaluation integration;
- AI Office model;
- public extension contracts.

## Reuse behind adapters

Examples:

- BullMQ for JobQueue;
- PostgreSQL;
- OpenTelemetry;
- provider SDKs;
- durable workflow engines;
- secret stores;
- object stores.

## Rule

Before a major dependency is introduced, document:

```text
capability
candidate
license
maturity
coupling risk
permanent contract
migration path
```
