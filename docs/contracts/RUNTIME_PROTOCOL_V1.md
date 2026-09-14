# Runtime Protocol v1

**Status:** Pre-1.0 contract

## Request

```text
runId
runAttemptId
agentVersionId
input
effectiveConfig
modelProfileVersionBindings
toolGrants
timeoutMs
policyContext
```

## Identity

- `runId` identifies logical execution.
- `runAttemptId` identifies one canonical execution attempt.
- queue delivery IDs are infrastructure metadata.

## Mandatory behavior

RuntimeAdapter must:

- execute only the referenced AgentVersion;
- preserve effective bindings;
- return structured success/failure;
- emit logs/events;
- honor timeout/cancellation capability;
- validate output when schema exists.

## Redelivery

Redelivery of the same RunAttempt reuses `runAttemptId`.

A new attempt receives a new `runAttemptId`.
