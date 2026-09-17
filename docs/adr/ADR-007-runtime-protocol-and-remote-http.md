# ADR-007: Runtime Protocol V1 and Remote HTTP Runtime

**Status:** Accepted for Stage 2 Slice 2.4

## Decision

ExecutionWorker dispatches through a `RuntimeAdapter` selected by the immutable
AgentVersion runtime binding. Trusted TypeScript remains one executor.
Remote HTTP is a second executor that speaks Runtime Protocol V1.

Runtime Protocol V1 is a JSON-safe, language-neutral HTTP contract. It is
separate from the internal `ExecutionRequest` reconstructed by
`ExecuteRunAttempt`.

## Runtime selection

```text
AgentVersion.manifest.runtime
  → RuntimeDispatcher
  → TrustedTypeScriptRuntimeAdapter | RemoteHttpRuntimeAdapter
```

Workflow nodes do not select runtimes. There is no runtime registry in this
slice.

## executionId

Runtime Protocol `executionId` is the canonical `RunAttemptId`. Queue
redelivery reuses it. A new logical RunAttempt receives a new `executionId`.

## Remote HTTP

Protocol V1 execution is one synchronous `POST` to the AgentVersion endpoint.
The adapter does not retry, follow redirects, or create a remote job
lifecycle. Timeouts and connection failures fail the current RunAttempt.

By default the worker refuses non-public destinations after DNS resolution.
`OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS` is an operator opt-in for
self-hosted private runtimes. AgentVersion cannot disable that policy.

Remote model and tool access goes through an OSVA capability bridge hosted by
the worker. The remote runtime receives an execution-scoped credential and
logical binding names only.
