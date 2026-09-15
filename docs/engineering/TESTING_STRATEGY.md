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
database (`pnpm test:integration`). Slice 1.3 adds a Valkey Docker harness
(`OSVA_TEST_VALKEY_URL` override, otherwise a temporary
`valkey/valkey:8.1.10-alpine` container) and real BullMQ adapter tests. Local
Docker Compose runs PostgreSQL and Valkey; web and worker connect to both.

## E2E
Maintain a small number of important product journeys.

## Evaluation
Agent quality evaluations are separate from software unit tests.
