# Repository Map

Architecturally meaningful packages after Stage 2.9 (Community Beta). Paths are relative to repo root.

## apps/

### apps/web

**Purpose:** Control-plane HTTP API (`/v1/*`).

**Owns:** Request routing, auth-less Community Beta API surface, persist-then-enqueue for Runs, control-plane CRUD for agents, workflows, tools, connectors, memory, evaluations.

**Does not own:** Agent execution, gateway mediation, workflow reconciliation loops.

**Depends on:** `@osva/domain`, `@osva/orchestration` (CreateRun), `@osva/db`, `@osva/adapters-bullmq`, `@osva/adapters-mcp-client` (discovery only).

**Key files:** `src/process.ts`, `src/http.ts`, `src/run-http.ts`, `src/workflow-http.ts`, `src/office-http.ts`.

### apps/worker

**Purpose:** ExecutionWorker — BullMQ consumer and runtime/gateway composition root.

**Owns:** RunAttempt execution wiring, gateway instances, runtime dispatch, capability server for remote runtimes, evaluation reconciliation hook.

**Does not own:** Run creation API, workflow DAG logic, cron scheduling.

**Depends on:** `@osva/orchestration`, `@osva/runtime-core`, gateway packages, runtime/model/MCP adapters, `@osva/db`, `@osva/adapters-bullmq`.

**Key files:** `src/process.ts`, `src/execute-run-attempt-handler.ts`, `src/worker.ts`.

### apps/workflow-orchestrator

**Purpose:** Durable workflow reconciliation loop.

**Owns:** Polling WorkflowRuns, invoking `ReconcileWorkflowRun`, creating child Runs and approval state transitions.

**Does not own:** HTTP API, direct runtime execution.

**Depends on:** `@osva/orchestration`, `@osva/db`, `@osva/adapters-bullmq`.

**Key files:** `src/process.ts`, `src/loop.ts`.

### apps/scheduler

**Purpose:** Cron schedule tick processor.

**Owns:** `SchedulerTick`, dispatching schedule occurrences to child Runs.

**Does not own:** Schedule CRUD (web), execution.

**Depends on:** `@osva/orchestration`, `@osva/db`, `@osva/adapters-bullmq`.

**Key files:** `src/process.ts`, `src/scheduler.ts`.

## packages/

### packages/contracts

**Purpose:** Public port interfaces, shared types, Zod schemas, error codes.

**Owns:** `JobQueue`, `RuntimeAdapter`, gateway ports, run/workflow state types, Runtime Protocol shapes.

**Does not own:** Business logic, persistence, provider SDK types.

**Depends on:** Nothing inward from domain/adapters.

### packages/domain

**Purpose:** Entities, state machines, repository ports, application services.

**Owns:** Run/RunAttempt/Workflow/Evaluation aggregates, effective bindings, transition rules, domain applications (`RunApplication`, `WorkflowApplication`, etc.).

**Does not own:** HTTP, BullMQ, provider SDKs, SQL.

**Depends on:** `@osva/contracts`.

### packages/orchestration

**Purpose:** Cross-aggregate write orchestration (no HTTP).

**Owns:** `CreateRun`, `ExecuteRunAttempt`, `ReconcileWorkflowRun`, `SchedulerTick`, `EvaluationCoordinator`, `LaunchAssignment`, `ReconcileAssignment`.

**Does not own:** Infrastructure adapters, HTTP routing.

**Depends on:** `@osva/domain`, `@osva/contracts`, `@osva/runtime-core` (execution request).

### packages/db

**Purpose:** PostgreSQL persistence via Drizzle ORM.

**Owns:** Schema, migrations, `Postgres*Repository` implementations, mappers.

**Does not own:** Domain rules, queue semantics.

**Depends on:** `@osva/domain` ports, `@osva/contracts` IDs.

### packages/model-gateway

**Purpose:** Provider-neutral model execution.

**Owns:** ModelProfileVersion resolution, provider dispatch, normalized errors and usage extraction.

**Does not own:** Provider SDK wiring (adapters), Run lifecycle.

**Depends on:** `@osva/contracts`, `@osva/domain` (ModelProfileRepository), provider adapters via `ModelProviderAdapter` interface.

### packages/tool-gateway

**Purpose:** Tool authorization and dispatch.

**Owns:** ToolPolicy enforcement, internal tool registry, MCP tool execution delegation.

**Does not own:** MCP transport (adapter), connector persistence, Run lifecycle.

**Depends on:** `@osva/contracts`, `@osva/domain`, optional `@osva/adapters-mcp-client` at composition root.

### packages/memory-gateway

**Purpose:** Persistent runtime memory mediation.

**Owns:** Binding resolution, permission checks, optimistic concurrency mapping, evaluation read-only enforcement.

**Does not own:** Namespace CRUD API (domain/web), PostgreSQL schema.

**Depends on:** `@osva/contracts`, `@osva/domain` (MemoryNamespaceRepository).

### packages/runtime-core

**Purpose:** Runtime selection and execution request construction.

**Owns:** `RuntimeDispatcher`, `createExecutionRequest`, executionId helpers.

**Does not own:** Concrete runtime implementations.

**Depends on:** `@osva/contracts`, `@osva/domain`.

### packages/runtime-protocol

**Purpose:** Runtime Protocol V1 schemas and capability path constants.

**Owns:** Zod schemas for execute/capability payloads, protocol version constants.

**Does not own:** HTTP server, gateway logic.

**Depends on:** `@osva/contracts`.

### packages/observability

**Purpose:** RunStep recording during execution.

**Owns:** `createRunStepRecorder` wrapping gateways with step persistence and cost estimation.

**Does not own:** Run state machines, HTTP observability API.

**Depends on:** Gateways, `@osva/domain`, `@osva/contracts`.

### packages/sdk

**Purpose:** TypeScript public SDK (`OsvaClient`) and runtime helpers (`@osva/sdk/runtime`).

**Owns:** HTTP client resources mirroring `/v1` API, remote runtime handler utilities.

**Does not own:** Server implementation.

**Depends on:** Public HTTP contract shapes (not server internals).

### packages/cli

**Purpose:** CLI over Node SDK.

**Owns:** `osva` bin, command routing.

**Does not own:** Parallel HTTP client implementation.

**Depends on:** `@osva/sdk`.

## adapters/

### adapters/bullmq

**Purpose:** `JobQueue` → BullMQ/Valkey.

**Owns:** Queue name, job name, BullMQ job ID encoding, consume/enqueue.

**Does not own:** RunAttempt creation, lifecycle transitions.

**Depends on:** `@osva/contracts`.

### adapters/runtime-typescript

**Purpose:** Trusted TypeScript child-process runtime.

**Owns:** Process spawn, protocol IPC, in-process model/tool/memory capability hooks.

**Does not own:** Gateway implementations.

**Depends on:** `@osva/contracts`, `@osva/runtime-protocol`.

### adapters/runtime-http

**Purpose:** Remote HTTP runtime and OSVA capability bridge/server.

**Owns:** Outbound execute POST, capability token verification, network policy for remote destinations, secret resolution from env.

**Does not own:** Run lifecycle, provider credentials passed to remote runtime.

**Depends on:** `@osva/contracts`, `@osva/runtime-protocol`, `@osva/runtime-core`.

### adapters/runtime-container

**Purpose:** Container runtime adapter and Docker Engine reference implementation.

**Owns:** `ContainerRuntimeAdapter`, internal `ContainerEngine` seam, Docker create isolation spec, bootstrap request registration (with `@osva/adapters-runtime-http`), stdout/log Runtime Protocol response transport, operator resource/network policy helpers, stale container cleanup.

**Does not own:** Run lifecycle, gateway implementations, Docker network productization.

**Depends on:** `@osva/contracts`, `@osva/runtime-protocol`, `@osva/runtime-core`, `@osva/adapters-runtime-http` (capability token issuance).

### adapters/model-openai / model-anthropic / model-gemini

**Purpose:** Provider-specific `ModelProviderAdapter` implementations.

**Owns:** SDK calls, response normalization to gateway contract.

**Does not own:** ModelProfile resolution, Run lifecycle.

**Depends on:** `@osva/model-gateway` adapter interface, provider SDKs (adapter boundary only).

### adapters/mcp-client

**Purpose:** MCP client pool (Streamable HTTP and stdio transports).

**Owns:** MCP protocol invoke/list, connection reuse per ConnectorVersion.

**Does not own:** ToolGateway policy, ToolVersion snapshots.

**Depends on:** `@osva/contracts` MCP types.

### adapters/opentelemetry

**Purpose:** Optional OpenTelemetry SDK wiring for OTLP traces and metrics.

**Owns:** `OsvaInstrumentation` adapter, env-based config, BullMQ trace propagation helpers.

**Does not own:** RunStep persistence, Run lifecycle.

**Depends on:** `@osva/observability`, OpenTelemetry SDK packages.

### adapters/memory

**Purpose:** In-memory repositories, fake runtime, test doubles.

**Owns:** Contract-test and unit-test infrastructure implementations.

**Does not own:** Production persistence.

**Depends on:** `@osva/domain`, `@osva/contracts`.

## sdks/ and examples/

### sdks/python

**Purpose:** Python SDK mirroring TypeScript control-plane and runtime helpers.

**Owns:** `osva-sdk` package, CI integration via `verify:python`.

**Does not own:** Server.

### examples/remote-runtime-node, examples/remote-runtime-python

**Purpose:** Remote HTTP runtime demonstration agents.

**Owns:** Sample Protocol V1 handlers.

**Does not own:** OSVA core.

## scripts/

### scripts/verification/

**Purpose:** Unified verification harness (`verify.mjs`).

**Owns:** `verify:quick`, `verify:ci`, `verify:ci:clean`, affected-package detection, doctor, Python gate.

**Does not own:** Product logic.

## docs/

**Purpose:** Architecture, contracts, platform, roadmap, ADRs, implementation stage specs.

**Start:** `docs/00-DOCUMENTATION-MAP.md`, `docs/architecture/` (this set), `docs/implementation/STAGE-2-COMMUNITY-BETA.md`.
