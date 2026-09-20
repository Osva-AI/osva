# Runtime Protocol v1

**Status:** Pre-1.0 contract

## Request

```text
runId
runAttemptId
workspaceId
agentId
agentVersionId
runtime
input
effectiveConfig
modelProfileVersionBindings
toolVersionBindings
toolGrants
timeoutMs
policyContext
```

`runtime` is the immutable AgentVersion runtime descriptor. `timeoutMs` is
copied from `AgentVersion.manifest.execution.timeoutMs`.

## Identity

- `runId` identifies logical execution.
- `runAttemptId` identifies one canonical execution attempt.
- queue delivery IDs are infrastructure metadata.

## Trusted agent context

The trusted TypeScript runtime passes a smaller frozen context into `run()`:

```text
input
runId
runAttemptId
workspaceId
agentId
agentVersionId
models.generateText(bindingName, request)
tools.invoke(bindingName, input, options?)
```

`models.generateText` accepts a logical binding name from the Run's persisted
`modelProfileVersionBindings` plus a provider-neutral request:

```text
messages: [{ role: system|user|assistant, content: string }, ...]
maxOutputTokens?
```

It returns `{ text }`. The child does not receive ModelProfileVersion IDs,
provider names, provider model IDs, API keys, or SDK objects. Parent/child
model IPC (`model.generate.request` / `succeeded` / `failed`) is an internal
runtime protocol, not a public HTTP contract.

`tools.invoke` accepts a logical binding name from the Run's persisted
`toolVersionBindings`, JSON-compatible input, and an optional caller-supplied
`idempotencyKey`. It returns JSON-compatible output. The child does not receive
ToolVersion IDs or implementation identifiers. Parent/child tool IPC
(`tool.invoke.request` / `succeeded` / `failed`) is an internal runtime
protocol, not a public HTTP contract.

It does not pass PostgreSQL, Valkey, BullMQ, provider clients, secrets,
ModelGateway objects, or ToolGateway objects.

## Mandatory behavior

RuntimeAdapter must:

- execute only the referenced AgentVersion;
- preserve effective bindings;
- return structured success/failure;
- emit logs/events;
- honor timeout/cancellation capability;
- validate output when schema exists.

Successful output must be JSON-compatible and is persisted on `RunAttempt`.

## Redelivery

Redelivery of the same RunAttempt reuses `runAttemptId`.

A new attempt receives a new `runAttemptId`.

## Runtime Dispatcher

`ExecuteRunAttempt` still reconstructs one internal `ExecutionRequest` and
calls one `RuntimeAdapter.execute`. `RuntimeDispatcher` selects the executor
from `ExecutionRequest.runtime.type`, which is copied from immutable
AgentVersion state. Trusted TypeScript and Remote HTTP are executor
implementations of that same lifecycle.

## HTTP wire protocol (Runtime Protocol V1)

Remote HTTP execution uses a separate JSON-safe language-neutral contract in
`@osva/runtime-protocol`. It is not TypeScript-specific and does not carry
provider SDK types, Dates, class instances, or database identifiers beyond
the opaque execution identity.

Execute request:

```json
{
  "protocolVersion": "1",
  "executionId": "<RunAttemptId>",
  "input": {},
  "capabilities": {
    "endpoint": "http://127.0.0.1:port",
    "token": "<execution-scoped credential>"
  }
}
```

`executionId` has a 1:1 identity with the canonical RunAttempt. Queue
redelivery reuses it. A new logical RunAttempt receives a new `executionId`.
Remote runtimes should treat repeated execute requests with the same
`executionId` as the same logical execution.

Success and failure responses must echo `protocolVersion` and `executionId`:

```json
{
  "protocolVersion": "1",
  "executionId": "<RunAttemptId>",
  "outcome": "SUCCEEDED",
  "output": {}
}
```

```json
{
  "protocolVersion": "1",
  "executionId": "<RunAttemptId>",
  "outcome": "FAILED",
  "error": { "code": "AGENT_EXECUTION_FAILED", "message": "..." }
}
```

A mismatched `executionId` is a protocol failure.

## Synchronous remote execution

Protocol V1 remote execution is one synchronous `POST` to the AgentVersion
endpoint. There is no remote job ID, 202/polling, webhook completion, or
remote attempt hierarchy. OSVA interprets the HTTP response and updates
canonical Run/RunAttempt state.

The HTTP adapter does not automatically retry the execute POST. Timeout,
connection failure, redirect, and HTTP 4xx/5xx fail the current RunAttempt
as `RUNTIME_TRANSPORT_FAILURE` or `RUNTIME_PROTOCOL_FAILURE`. A later queue
redelivery may call again with the same `executionId`.

By default the adapter refuses loopback, link-local, private, unspecified,
and multicast destinations, including hostnames that resolve to those
addresses. That check happens at the outbound execute boundary, not from
Run or workflow input. The worker resolves each hostname once, validates
every returned address, and connects to the pinned address directly so a
later DNS rebinding lookup cannot redirect the socket. Operators may set
`OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS=true` on the worker to allow
self-hosted private runtimes. AgentVersion configuration cannot enable
that opt-in. Redirects are not followed, so resolved credentials are never
forwarded to another host.

Maximum request/response body size is 1,048,576 bytes.

## Failure categories

- `RUNTIME_TRANSPORT_FAILURE`: DNS/connect failure, timeout, redirect, HTTP 4xx/5xx
- `RUNTIME_PROTOCOL_FAILURE`: invalid JSON/schema/version, wrong executionId, oversized body, unexpected content type
- `AGENT_EXECUTION_FAILED`: a valid protocol response with `outcome: "FAILED"`

These categories do not select retry policy in this slice.

## Capability bridge

Remote runtimes do not receive ModelGateway, ToolGateway, provider
credentials, or version IDs. They call:

```text
POST {capabilities.endpoint}/v1/runtime/capabilities/models/generate-text
POST {capabilities.endpoint}/v1/runtime/capabilities/tools/invoke
POST {capabilities.endpoint}/v1/runtime/capabilities/artifacts/create   (multipart; streamed file body)
POST {capabilities.endpoint}/v1/runtime/capabilities/artifacts/get      (JSON metadata)
GET  {capabilities.endpoint}/v1/runtime/capabilities/artifacts/content  (streamed bytes)
```

Artifact bytes **must not** be embedded in Runtime Protocol V1 execute request/response JSON. They use the capability side channel above while metadata and `ArtifactReferenceV1` values may appear in normal Run JSON output.

with `Authorization: Bearer <token>`. The token is opaque, execution-scoped,
short-lived, and bound to the canonical RunAttempt. It is valid only while
that RunAttempt is `RUNNING`. It is not logged or persisted as lifecycle
data.

Capability requests use logical binding names. OSVA resolves immutable
effective bindings server-side. Remote runtimes cannot create Runs,
WorkflowRuns, approvals, or other agent executions.
