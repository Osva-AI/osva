# Compatibility and Migration

## Version public contracts

Explicitly version:

- Agent Manifest;
- Runtime Protocol;
- Workflow Definition;
- Event Envelope;
- Tool Contract;
- REST API;
- SDK;
- adapter interfaces.

## Adapter replacement

Replacing an implementation must preserve:

1. product semantics;
2. canonical OSVA IDs;
3. persisted historical state;
4. documented compatibility.

## Deprecation

```text
introduce new version
→ support old + new
→ migration
→ deprecation
→ removal at major boundary
```
