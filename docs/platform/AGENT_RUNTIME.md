# Agent Runtime

RuntimeAdapters execute AgentVersions.

## Stage evolution

```text
trusted TypeScript
→ Node SDK
→ Python SDK
→ remote HTTP
→ container
→ stronger isolation
```

## Isolation classes

```text
L0 trusted package
L1 dedicated process
L2 container
L3 sandboxed container/microVM
L4 external runtime
```

See Runtime Protocol v1 for execution semantics.
