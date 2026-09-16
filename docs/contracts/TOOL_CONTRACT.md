# Tool Contract

## Tool and ToolVersion

`Tool` is stable control-plane identity. Only descriptive metadata such as
`name` may change.

`ToolVersion` is immutable and append-only. Community Alpha Slice 1.6 supports
`INTERNAL` tool versions whose `implementation` must reference an allowlisted
built-in identifier such as `OSVA_ECHO_V1` or `OSVA_CLOCK_NOW_V1`.

## Logical bindings

AgentVersions declare named logical tool bindings. CreateRun freezes those
bindings into `Run.effectiveBindings.toolVersionBindings`. Runtime resolves
binding names only from the persisted Run snapshot.

## Invocation

Tool execution occurs inside canonical Run execution through ToolGateway.
There is no public HTTP invoke endpoint in Slice 1.6.

Trusted TypeScript agents call `context.tools.invoke(bindingName, input)`.
The child never receives ToolVersion IDs or implementation identifiers.

## Idempotency

The optional caller-supplied idempotency key identifies a logical side effect.

It remains stable across retries/redelivery of the same operation.

RunAttempt ID, queue job ID, delivery count, and process ID must not be used
as the logical idempotency key.

Slice 1.6 does not persist idempotency deduplication yet.

## Permission

Every ToolGateway invocation passes through ToolPolicy.

Prompt/model output cannot grant permission. Unbound tools are rejected before
ToolGateway invocation with `TOOL_BINDING_NOT_FOUND`.
