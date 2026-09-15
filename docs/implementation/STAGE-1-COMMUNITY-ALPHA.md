# Stage 1 Community Alpha

## Goal
Ship the first complete OSVA execution loop.

## Build

- registry;
- immutable AgentVersions;
- Runs and RunAttempts;
- BullMQ adapter;
- ExecutionWorker;
- trusted TypeScript RuntimeAdapter;
- manual/API/scheduled Runs;
- first model adapter;
- Tool and ToolVersion support;
- logs and RunSteps;
- usage/cost;
- basic evaluations;
- Run inspector.

Slice 1.1 exposes the control-plane Agent Registry over HTTP (`/v1/agents` and
nested `/versions` routes). `Agent` remains stable identity plus mutable `name`.
`AgentVersion` remains an immutable append-only snapshot whose integer `version`
is assigned by the server. Creating an Agent or AgentVersion does not execute a
Run.

## Quality

- JobQueue contract tests;
- runtime contract tests;
- PostgreSQL integration tests;
- Redis/BullMQ integration tests;
- E2E successful and failed Runs;
- retry and immutable-binding tests.
