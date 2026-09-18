# Stage 3.1: Container Runtime and Execution Isolation

## Objective

Add `CONTAINER` as an immutable AgentVersion runtime that executes agents in
ephemeral OCI containers while reusing Runtime Protocol V1 and the existing OSVA
Runtime Capability Bridge.

## Runtime Protocol V1 vs transport

Runtime Protocol V1 defines request/response schemas and execution semantics.
Transport is **RuntimeAdapter-specific**.

| Runtime | Request delivery | Response / diagnostics |
|---|---|---|
| `TRUSTED_TYPESCRIPT` | Node/process transport | In-process protocol I/O |
| `REMOTE_HTTP` | HTTP POST body | HTTP response body |
| `CONTAINER` | Bootstrap HTTP GET (execution-scoped token) | One response line on container stdout (retrieved via Docker logs); stderr diagnostics |

## CONTAINER AgentRuntime contract

`AgentManifest.runtime` may be:

```text
type: "CONTAINER"
protocolVersion: "1"
image: repository@sha256:<64-hex>
command?: string[]
resources?: { cpuMillis?, memoryMiB?, pids? }
```

Execution timeout remains `execution.timeoutMs` → `ExecutionRequest.timeoutMs`.

## Canonical digest-pinned OCI image rule

OSVA accepts only canonical references:

```text
repository@sha256:<64-hex>
```

Rejected forms include tag-only references (`agent:latest`) and
`repository:tag@sha256:<digest>` even when digest-pinned.

Registry ports before the first `/` remain valid
(`localhost:5000/agent@sha256:<digest>`).

Private registry credential productization is deferred. Docker daemon credential
helpers may still authenticate pulls without OSVA storing registry secrets.

## RuntimeDispatcher flow

```text
RunAttempt
  → RuntimeDispatcher
  → ContainerRuntimeAdapter
  → ContainerEngine
  → DockerEngineAdapter
  → ephemeral OCI container
```

`executionId` equals `RunAttemptId`. Container IDs are infrastructure metadata
only and are not part of Run lifecycle contracts.

One `RuntimeAdapter.execute()` invocation performs at most one container
execution. The adapter does **not** automatically replay an execution after the
container may have started. Logical retries are owned by OSVA RunAttempt
lifecycle semantics (a new logical retry creates a new RunAttemptId when
required).

## ContainerRuntimeAdapter

Located in `@osva/adapters-runtime-container`.

Responsibilities:

- validate digest-pinned image descriptor
- resolve operator resource policy
- build RuntimeExecuteRequest V1 (including capability endpoint/token in the payload)
- register the request in ephemeral `RuntimeExecutionBootstrapStore`
- issue an execution-scoped bootstrap token
- inject bootstrap environment variables (see below)
- remove stale OSVA-managed container for the same RunAttemptId
- ensure image
- create/start one container
- wait for exit; retrieve bounded stdout/stderr via Docker logs
- parse exactly one RuntimeExecuteResponse from stdout
- normalize to `ExecutionResult`
- clear bootstrap state and stop/kill/remove container in all paths
- terminate active executions on `close()`

### Bootstrap execution flow

```text
ContainerRuntimeAdapter
  → creates RuntimeExecuteRequest V1
  → registers request in RuntimeExecutionBootstrapStore
  → issues execution-scoped bootstrap token
  → injects:
       OSVA_EXECUTION_ID
       OSVA_RUNTIME_BOOTSTRAP_URL
       OSVA_RUNTIME_BOOTSTRAP_TOKEN
  → starts container
  → container GETs bootstrap request (consumed once)
  → agent executes
  → one RuntimeExecuteResponse on stdout
  → diagnostics on stderr
  → container exits
  → Docker logs retrieved
  → response parsed
  → container removed
  → bootstrap state cleared
```

Bootstrap endpoint (internal capability bridge):

```text
GET {container-reachable-base}/v1/runtime/executions/bootstrap?executionId={RunAttemptId}
Authorization: Bearer {bootstrap-token}
→ RuntimeExecuteRequest V1
```

## ContainerEngine boundary

Internal infrastructure seam. Not a public OSVA contract.

Operations: ensure image, create, start, run protocol execution (start → wait →
logs), stop/kill/remove, find execution container by label.

## DockerEngineAdapter

Reference `ContainerEngine` implementation using Docker Engine API via
`dockerode`. Docker SDK types remain inside the adapter package.

Execution lifecycle:

```text
start container
→ wait for exit OR ExecutionRequest.timeoutMs
→ retrieve stdout/stderr via Docker logs (demuxed, bounded)
→ parse bounded stdout for RuntimeExecuteResponse
```

Execution timeouts race `container.wait()` against `ExecutionRequest.timeoutMs`.
When timeout wins, the adapter kills the container and returns a deterministic
transport timeout failure.

Ambiguous post-start transport failures (empty stdout, protocol parse failure
after start, agent failure, timeout) fail the current RunAttempt deterministically.

## One container per RunAttempt execution

Each adapter invocation creates one ephemeral container labeled:

```text
osva.managed=true
osva.execution.id=<RunAttemptId>
```

Queue redelivery reuses the same RunAttemptId and therefore removes any stale
OSVA-managed container before starting a clean execution.

## Runtime Protocol semantics (CONTAINER)

At the protocol layer:

```text
RuntimeExecuteRequest  → delivered via bootstrap HTTP GET (adapter transport)
RuntimeExecuteResponse → exactly one JSON line on container stdout
stderr                 → diagnostics only
```

Output limits:

- stdout: `RUNTIME_PROTOCOL_MAX_BODY_BYTES` (1 MiB)
- stderr: `CONTAINER_PROTOCOL_STDERR_MAX_BYTES` (64 KiB)

Excess output is discarded without unbounded worker memory growth.

## Capability bridge reuse

After bootstrap, the container holds RuntimeExecuteRequest V1, including:

```text
protocolVersion
executionId
input
capabilities.endpoint
capabilities.token
```

Model/tool/memory access re-enters OSVA through the existing Runtime Capability
Bridge with execution-scoped HMAC capability tokens. Binding IDs, database
credentials, queue handles, provider API keys, Valkey URLs, and the capability
signing secret never enter container code or environment.

Bootstrap URL and bootstrap token **do** enter the container environment (see
host trust below). They authorize only a single fetch of that execution's
RuntimeExecuteRequest.

## Resource policy

Operator-controlled defaults and maximums for `cpuMillis`, `memoryMiB`, and
`pids`. Absent AgentVersion requests use defaults. Requests above maximums are
rejected deterministically; OSVA never silently clamps.

## Operator network configuration

`ContainerNetworkConfig` is operator-owned at worker/adapter composition.
AgentVersion, Run input, and workflow input cannot select Docker networks.

Supported: bridge/custom operator networks.
Forbidden: `host`, `none`.

Formal outbound internet egress firewalling is deferred to Stage 3.7.

## Capability URL reachability

Bridge containers cannot reach `http://127.0.0.1`. When container execution is
enabled, workers bind the capability server on `0.0.0.0` and resolve a
container-reachable URL via:

```text
OSVA_CONTAINER_CAPABILITY_BASE_URL
```

or a platform suggestion (`host.docker.internal` on Docker Desktop,
`172.17.0.1` on Linux bridge networks).

Explicit loopback URLs fail configuration validation when container execution is
enabled.

## Timeout and cancellation

Only `ExecutionRequest.timeoutMs` applies. It covers bootstrap fetch and agent
execution in the container. On timeout: stop → grace → kill → remove →
deterministic transport failure (`RUNTIME_TRANSPORT_FAILURE`, message
"Container runtime execution timed out.").

## Stale/redelivery behavior

Before execution, the adapter finds OSVA-managed containers labeled with the
current RunAttemptId, terminates them, and removes them. Logical retries create
new RunAttemptIds and therefore new containers.

## Bootstrap security and host trust (Stage 3.1)

- Bootstrap token is **short-lived** (aligned with execution timeout + skew).
- Bootstrap token is **execution-scoped** (must match `executionId` query param).
- Bootstrap request registration is **single-use** (consumed on successful GET).
- Bootstrap state is **ephemeral in-memory** only (worker restart may lose pending
  registration; queue redelivery re-registers).
- Docker host/operator access is **trusted infrastructure access** for Stage 3.1.
  An operator with Docker inspect access may read container environment
  (including bootstrap URL/token).
- No database, Valkey, provider, or worker signing secrets enter the container.
- No Docker socket enters the container.
- Capability bridge remains the only model/tool/memory access path after bootstrap.

Stronger protection against host inspection is deferred beyond this slice (not
Stage 3.7 egress hardening in this document).

## Security and isolation controls

Enforced at Docker create:

```text
Privileged=false
CapDrop=ALL
no-new-privileges
no host PID/IPC/network namespaces
no published ports
no arbitrary bind mounts
no Docker socket
no devices
restart policy = never
CPU/memory/PID limits
read-only root filesystem + controlled tmpfs scratch
explicit bootstrap env only (no worker process.env inheritance)
OpenStdin=false / AttachStdin=false
```

## Container user behavior

OSVA does not force an arbitrary UID. Image-defined users are preserved.
Non-root images and rootless-compatible Docker engines are recommended for
production.

Container isolation is stronger than Trusted TypeScript but is **not** a complete
hostile-code sandbox and does not claim Firecracker/gVisor/Kata-level isolation.

## Failure categories

| Category | Code | Examples |
|---|---|---|
| Protocol failure | `RUNTIME_PROTOCOL_FAILURE` | malformed JSON, extra stdout, oversized stdout, mismatched executionId |
| Agent failure | `AGENT_EXECUTION_FAILED` | valid FAILED RuntimeExecuteResponse |
| Transport failure | `RUNTIME_TRANSPORT_FAILURE` | timeout, bootstrap fetch failure, non-zero exit without valid response, engine errors |
| Unsupported runtime | `UNSUPPORTED_RUNTIME` | dispatcher misconfiguration |

## Known limitations

- Docker Engine required when container execution is enabled
- No registry credential productization
- No warm pools or persistent workspaces
- No Podman/Kubernetes runtime adapters in this slice
- Linux bridge gateway reachability may require explicit operator URL override
- Capability bridge must be reachable from the configured container network

## Explicit non-goals

```text
ArtifactStore
knowledge/retrieval
Helm/Kubernetes Jobs
full egress firewall (Stage 3.7)
Firecracker/gVisor/Kata
GPU support
container lifecycle domain entities
```

## Reference example

`examples/container-runtime-python/` demonstrates bootstrap request retrieval,
Runtime Protocol V1 execution, and capability bridge tool invocation.
