# Agent Runtime

RuntimeAdapters execute AgentVersions.

## Dispatch

```text
ExecutionWorker
  → RuntimeDispatcher
  → RuntimeAdapter.execute(ExecutionRequest)
```

The dispatcher selects an executor from the immutable AgentVersion runtime
binding. Workflow node configuration cannot override it. Trusted TypeScript
is one implementation. Remote HTTP is another. There is no runtime registry
in Slice 2.4.

## Stage evolution

```text
trusted TypeScript
→ remote HTTP (Runtime Protocol V1)
→ Node SDK
→ Python SDK
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

Slice 2.4 adds L4 remote HTTP through Runtime Protocol V1. The remote process
is not an OSVA lifecycle authority.

## Trusted TypeScript runtime

Production workers compose `@osva/adapters-runtime-typescript` behind
`RuntimeDispatcher`.

- Operator configuration: `OSVA_TRUSTED_RUNTIME_ROOT`.
- Entrypoints must resolve beneath that root after `realpath`.
- Integrity is SHA-256 of the declared entrypoint file.
- Modules export `export async function run(context)`.
- Timeout is parent-enforced by killing the child.
- Child environment is an allowlist and omits `OSVA_DATABASE_URL`,
  `OSVA_VALKEY_URL`, and `OPENAI_API_KEY`.
- Child processes are started with Node `--permission` as defense-in-depth
  (read grants for the runner and trusted root; no write, child-process,
  worker, or addon grants). This is not a hostile-code sandbox.
- Model access is the in-process `context.models.generateText` capability.
- Tool access is the in-process `context.tools.invoke` capability.

## Remote HTTP runtime

`REMOTE_HTTP` AgentVersions execute through `@osva/adapters-runtime-http`.

- Endpoint and optional `authSecretRef` are immutable AgentVersion fields.
- Execution is one synchronous Runtime Protocol V1 POST. Redirects are not
  followed. The adapter does not retry.
- `executionId` equals the canonical RunAttemptId.
- Model and tool access is mediated by the worker-hosted capability bridge.
- Capability credentials are execution-scoped HMAC tokens. They are not
  stored as plaintext lifecycle data.
- Optional worker configuration: `OSVA_RUNTIME_CAPABILITY_SECRET`,
  `OSVA_RUNTIME_CAPABILITY_HOST` (default `127.0.0.1`),
  `OSVA_RUNTIME_CAPABILITY_PORT` (default `0`),
  `OSVA_RUNTIME_CAPABILITY_BASE_URL`. Trusted-only workers may omit them.
- Outbound network policy is worker-owned. By default `REMOTE_HTTP` may
  connect only to public unicast destinations. Loopback, link-local,
  private, unspecified, and multicast addresses are rejected after DNS
  resolution at execute time. `OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS=true`
  is an operator opt-in for self-hosted private runtimes. AgentVersion,
  Run input, and workflow input cannot enable it. Redirects remain disabled.

See Runtime Protocol v1 and Agent Manifest v1.

## Container runtime

`CONTAINER` AgentVersions execute through `@osva/adapters-runtime-container`.

- Image references must be OSVA-canonical digest-pinned OCI references:
  `repository@sha256:<64-hex>`.
- One ephemeral OCI container represents one RunAttempt execution (`executionId`
  equals the canonical RunAttemptId). One adapter `execute()` performs at most
  one container execution; no automatic post-start replay.
- Runtime Protocol V1 request/response schemas apply; CONTAINER transport uses
  bootstrap HTTP GET for `RuntimeExecuteRequest` and container stdout (via Docker
  logs) for `RuntimeExecuteResponse`; stderr is diagnostics only.
- Model/tool/memory access uses the existing Runtime Capability Bridge with
  execution-scoped HMAC capability tokens delivered in the bootstrapped
  RuntimeExecuteRequest payload.
- Container environment receives bootstrap variables only (plus image-defined
  env); worker `process.env` is never inherited.
- Bootstrap URL/token are short-lived, execution-scoped, and single-use; Docker
  host/operator inspect access is trusted infrastructure for Stage 3.1.
- CPU/memory/PID limits are operator-controlled with defaults and maximums.
- Docker network mode is operator-owned (`ContainerNetworkConfig`). AgentVersion
  cannot select host networking or infrastructure networks.
- Bridge containers cannot reach capability servers advertised on loopback. Set
  `OSVA_CONTAINER_CAPABILITY_BASE_URL` to a container-reachable URL when enabling
  container execution.
- Container isolation is stronger than Trusted TypeScript but is not a complete
  hostile-code sandbox. Non-root images and rootless-compatible Docker engines
  are recommended for production.

See `docs/implementation/STAGE-3-1-CONTAINER-RUNTIME.md` and
`docs/architecture/flows/container-runtime-execution.md`.
