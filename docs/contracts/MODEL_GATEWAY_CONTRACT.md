# ModelGateway Contract

## Domain

Agents refer to ModelProfiles through logical binding names.

Runs bind to immutable ModelProfileVersions. CreateRun copies
`AgentVersion.manifest.models` into
`Run.effectiveBindings.modelProfileVersionBindings`. Runtime execution must
reuse that snapshot and must not re-resolve the AgentVersion.

## Stage 1 generateText

Stage 1 implements a deliberately small text-generation operation:

```text
modelProfileVersionId
messages: [{ role: system|user|assistant, content: string }, ...]
maxOutputTokens?
```

Result:

```text
text
```

Trusted agent code never supplies `modelProfileVersionId`. The runtime resolves
the logical binding name from the persisted Run snapshot, then calls
ModelGateway.

Runtime cancellation is an internal ModelGateway execution option
(`generateText(request, { signal })`). It is not part of this serialized
request contract, public HTTP APIs, or parent/child IPC.

## Target invoke

The destination ModelGateway surface remains `invoke()`:

```text
modelProfileVersionId
instructions
input
structuredOutputSchema?
toolDefinitions?
timeout
metadata
```

Response (destination):

```text
provider
model
providerResponseId?
output
usage
latencyMs
```

Stage 1 does not implement invoke, streaming, tools, structured output, or
usage persistence.

## Usage

Normalize later:

- input tokens/units;
- output tokens/units;
- cached units when available;
- estimated cost separately.

Stage 1 may observe provider usage internally. It does not persist usage, price
tokens, or expose raw provider usage objects to agent code.

## Rules

- provider SDK objects do not escape the provider adapter;
- retries reuse the effective ModelProfileVersion binding;
- provider errors map into OSVA error taxonomy;
- secrets never enter persisted request metadata, HTTP contracts, runtime IPC,
  or child environments;
- ModelGateway does not own Run lifecycle persistence.
