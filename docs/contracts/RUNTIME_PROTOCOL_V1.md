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
```

It does not pass PostgreSQL, Valkey, BullMQ, provider clients, secrets,
ModelGateway, or ToolGateway objects.

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
