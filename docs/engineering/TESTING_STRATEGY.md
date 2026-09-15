# Testing Strategy

## Domain tests
State machines, version immutability, workflow transitions.

## Contract tests
Every concrete adapter passes a shared suite.

Examples:

```text
JobQueueContractTests
RuntimeAdapterContractTests
ModelGatewayContractTests
ToolExecutorContractTests
SecretResolverContractTests
```

## Integration
Use real PostgreSQL and Redis/Valkey for critical paths.

Stage 0 integration tests apply committed PostgreSQL migrations against a real
database (`pnpm test:integration`). Local Docker Compose also starts Valkey for
the Stage 1 topology; Stage 0 application tests do not use it.

## E2E
Maintain a small number of important product journeys.

## Evaluation
Agent quality evaluations are separate from software unit tests.
