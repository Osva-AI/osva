# SecretResolver Contract

## Purpose

Resolve secret values without storing them in normal OSVA records.

## Interface

```text
resolve(secretReference) -> secret value
```

## Rules

- secret values never returned to browser APIs;
- secret values never logged;
- domain stores references only;
- `.env` is one possible implementation, not the domain model.

## Future adapters

May include Vault-compatible or cloud secret systems.
