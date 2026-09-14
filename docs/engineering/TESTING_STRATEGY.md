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

## E2E
Maintain a small number of important product journeys.

## Evaluation
Agent quality evaluations are separate from software unit tests.
