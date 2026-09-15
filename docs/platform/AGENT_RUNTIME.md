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

Slice 1.4 implements L1 for trusted TypeScript: a dedicated Node child process
for fault isolation and timeout enforcement. It is not L2/L3 sandboxing and is
not safe for hostile user-submitted code.

## Trusted TypeScript runtime

Production workers compose `@osva/adapters-runtime-typescript`.

- Operator configuration: `OSVA_TRUSTED_RUNTIME_ROOT`.
- Entrypoints must resolve beneath that root after `realpath`.
- Integrity is SHA-256 of the declared entrypoint file.
- Modules export `export async function run(context)`.
- Timeout is parent-enforced by killing the child.
- Child environment is an allowlist and omits `OSVA_DATABASE_URL` and
  `OSVA_VALKEY_URL`.
- Child processes are started with Node `--permission` as defense-in-depth
  (read grants for the runner and trusted root; no write, child-process,
  worker, or addon grants). This is not a hostile-code sandbox.
- Model and tool capabilities are intentionally unavailable.

See Runtime Protocol v1 and Agent Manifest v1.
