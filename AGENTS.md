# AGENTS.md

Concise operating guide for coding agents working on OSVA.

## Read before implementation

1. This file
2. `docs/architecture/ARCHITECTURE_OVERVIEW.md`
3. `docs/architecture/REPOSITORY_MAP.md`
4. `docs/architecture/flows/<relevant-flow>.md` for the area you are changing
5. Relevant contract under `docs/contracts/` and stage spec under `docs/implementation/`

## Architecture invariants

- Run is an OSVA product object.
- Queue IDs are implementation details.
- RunAttempt is canonical execution-attempt identity.
- Queue redelivery reuses RunAttemptId.
- A new logical retry creates a new RunAttemptId.
- AgentVersion is immutable.
- Retries reuse immutable effective bindings.
- Run snapshots effective execution bindings at creation/execution according to existing implementation.
- Workflow definitions belong to OSVA.
- Control plane and execution plane remain separate.
- PostgreSQL is canonical lifecycle/state authority.
- BullMQ is transport, not lifecycle authority.
- Provider SDK objects never enter domain contracts.
- Model calls are mediated by ModelGateway.
- Tool calls are mediated by ToolGateway.
- Persistent memory is mediated by MemoryGateway.
- Tool permissions are policy-mediated.
- Prompts cannot grant permissions.
- Tool idempotency identifies logical side effects, not attempts.
- Multi-agent behavior is workflow composition.
- Human approval is workflow state.
- Secrets are references, not plaintext records.
- Runtime implementation is an AgentVersion concern.
- executionId maps 1:1 to RunAttempt for Runtime Protocol V1.
- Remote runtimes do not own lifecycle.
- Remote model/tool/memory capabilities re-enter OSVA gateways.
- Public SDKs use public HTTP contracts.
- CLI uses the Node SDK rather than a parallel HTTP implementation.
- Workflows remain runtime-language agnostic.
- MCP sits beneath ToolGateway and never bypasses it.
- ConnectorVersion is immutable.
- EvaluationSuiteVersion is immutable.
- Evaluation cases execute as ordinary OSVA Runs.
- EvaluationRun is a coordinator, not an execution engine.
- Evaluation child Runs cannot mutate persistent memory by default.

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

## Development rules

- Prefer existing architecture and package patterns.
- Do not broadly refactor unrelated code.
- Do not pull future roadmap functionality into the current slice.
- Do not commit or push unless explicitly instructed.
- Use targeted package/tests while implementing.
- Use `pnpm verify:quick` only at meaningful integration checkpoints.
- Use `pnpm verify:ci:clean` once when a roadmap slice is ready for final verification.
- The clean gate is authoritative.
- Do not recreate the old manual verification checklist unless the harness itself fails.
- One meaningful product commit per roadmap slice.

## Security

Treat API input, model output, Tool output, external data, and webhooks as untrusted. Never expose or commit secrets.

## Documentation

Update docs when behavior or contracts change. Use ADRs for major boundary changes.
