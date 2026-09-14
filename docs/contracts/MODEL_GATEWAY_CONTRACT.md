# ModelGateway Contract

## Domain

Agents refer to ModelProfiles.

Runs bind to immutable ModelProfileVersions.

## Request

Conceptually:

```text
modelProfileVersionId
instructions
input
structuredOutputSchema?
toolDefinitions?
timeout
metadata
```

## Response

```text
provider
model
providerResponseId?
output
usage
latencyMs
```

## Usage

Normalize:

- input tokens/units;
- output tokens/units;
- cached units when available;
- estimated cost separately.

## Rules

- provider SDK objects do not escape adapter;
- retries reuse effective ModelProfileVersion binding;
- provider errors map into OSVA error taxonomy;
- secrets never enter persisted request metadata.
