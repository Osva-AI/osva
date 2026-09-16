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
