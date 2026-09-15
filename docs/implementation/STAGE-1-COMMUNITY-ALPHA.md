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

Slice 1.2 exposes the Stage 0 CreateRun lifecycle over HTTP (`/v1/runs` and
nested `/attempts` routes) and hardens Run/RunAttempt persistence. Callers
request an AgentVersion; OSVA resolves the current Stage-0-compatible
`effectiveBindings` and stores that immutable snapshot on the Run. Run and the
initial RunAttempt are created atomically. Lifecycle updates use expected-state
compare-and-set semantics and cannot overwrite immutable identity, bindings, or
input. Runs are listed with opaque cursor pagination. Queue payload remains
exactly `{ runAttemptId }`.

Slice 1.3 replaces production `DiscardingJobQueue` with `@osva/adapters-bullmq`,
a BullMQ `JobQueue` on Valkey. `CreateRun` enqueues `{ runAttemptId }` onto the
`osva-execution` queue. `apps/worker` is the ExecutionWorker composition root:
it waits for PostgreSQL and Valkey, then consumes that queue and delegates to
`ExecuteRunAttempt`. BullMQ job IDs and job names are infrastructure-only.
PostgreSQL remains the canonical Run/RunAttempt lifecycle store.

Slice 1.4 adds `@osva/adapters-runtime-typescript`, the first production
RuntimeAdapter. It executes operator-installed TypeScript modules from
`OSVA_TRUSTED_RUNTIME_ROOT` in a dedicated child process. AgentVersion manifests
identify the relative entrypoint, SHA-256 digest, and timeout
(`execution.timeoutMs`). Production workers consume BullMQ jobs when PostgreSQL,
Valkey, and the trusted runtime root are ready. This is a trusted-code runtime,
not an untrusted sandbox.

Slice 1.5 adds the provider-neutral ModelGateway, an immutable ModelProfile /
ModelProfileVersion control-plane registry, and the first provider adapter
using OpenAI's Responses API. AgentVersions may declare named logical model
bindings. CreateRun freezes those bindings into
`Run.effectiveBindings.modelProfileVersionBindings`. Trusted TypeScript agents
call `context.models.generateText(bindingName, request)` through the existing
runtime IPC channel. The child never receives an SDK client, API key, provider
model ID, or ModelProfileVersion ID. `OPENAI_API_KEY` is optional and
worker-only; missing it does not block worker startup. Streaming, tools,
structured output, usage accounting, and additional providers remain later
slices.

## Quality

- JobQueue contract tests;
- runtime contract tests;
- PostgreSQL integration tests;
- Redis/BullMQ integration tests;
- E2E successful and failed Runs;
- retry and immutable-binding tests;
- ModelGateway and OpenAI adapter tests against a local fake Responses endpoint;
- E2E trusted-agent `generateText` without a live paid OpenAI key.
