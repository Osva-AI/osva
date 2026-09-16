# AGENTS.md

Repository-wide instructions for Codex and other coding agents working on OSVA.

## Read before implementation

Read:

1. `README.md`
2. `docs/00-DOCUMENTATION-MAP.md`
3. `docs/architecture/ARCHITECTURAL_INVARIANTS.md`
4. relevant contract documents under `docs/contracts/`
5. relevant platform documents
6. relevant ADRs
7. the current implementation-stage specification

## Permanent product concepts

Examples:

- Agent
- AgentVersion
- Deployment
- Run
- RunAttempt
- RunStep
- Workflow
- WorkflowVersion
- WorkflowRun
- WorkflowNodeRun
- Tool
- ToolVersion
- ModelProfile
- ModelProfileVersion
- Evaluation
- OfficeWorker

Replaceable infrastructure includes queues, workflow engines, provider SDKs, telemetry backends, secret stores, object stores, identity providers, vector stores, policy engines, and sandbox technologies.

## Dependency direction

```text
applications / composition root
           ↓
        adapters
           ↓
        contracts
           ↑
     domain/services
```

Core/domain code must not import concrete infrastructure adapters.

Examples:

- depend on `JobQueue`, not BullMQ;
- depend on `ModelGateway`, not OpenAI SDK types;
- OSVA owns Workflow definitions;
- OSVA owns Run and RunAttempt identities.

## Control and execution

The control plane owns product state and intent.

ExecutionWorkers run Agent code through RuntimeAdapters.

Do not execute arbitrary Agent code inside normal HTTP request handlers.

## Reproducibility

A Run must preserve immutable effective bindings.

Retries of the same logical operation must not silently resolve newer AgentVersions, ToolVersions, WorkflowVersions, or ModelProfileVersions.

## Current-stage discipline

The target architecture defines where a feature belongs.

The current stage defines how much to build now.

Do not implement later-stage capabilities unless requested.

## Contracts

Treat documents in `docs/contracts/` as public architectural contracts.

If implementation reveals a genuine contract problem:

1. stop;
2. explain the problem;
3. propose the smallest compatible correction;
4. update the contract and ADR if accepted.

Do not silently change contract semantics.

## Security

Treat API input, model output, Tool output, external data, and webhooks as untrusted.

Never expose or commit secrets.

Tool access is permissioned server-side.

## Testing

Every concrete infrastructure adapter must pass the shared contract tests for its interface.

Permanent state machines and invariants require unit tests.

See `docs/engineering/DEVELOPMENT_GATES.md`.

During implementation, run `pnpm verify:quick` at meaningful checkpoints.

Before completion, run `pnpm verify:ci:clean`.

Do not claim commands passed unless they were actually executed.

## Documentation

Update documentation when behavior or contracts change.

Use ADRs for major architectural choices or changes to permanent boundaries.
