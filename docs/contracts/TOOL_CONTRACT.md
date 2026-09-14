# Tool Contract

## ToolVersion

Immutable fields include:

- Tool ID;
- ToolVersion ID;
- input schema;
- output schema;
- risk classification;
- timeout;
- idempotency behavior;
- implementation reference;
- credential requirements.

## Invocation

Every invocation records effective ToolVersion.

## Idempotency

The idempotency key identifies a logical side effect.

It remains stable across retries/redelivery of the same operation.

Attempt ID may be logged but must not change logical idempotency.

## Permission

ToolGrant and policy checks occur before execution.

Prompt/model output cannot grant permission.
