# Agent Manifest v1

**Status:** Pre-1.0 contract

## Purpose

Describes the executable contract of an AgentVersion.

## Required fields

```yaml
schemaVersion: "1"
key: example-agent
name: Example Agent

runtime:
  type: BUILTIN_PACKAGE
  key: example-agent

input:
  schema: {}

output:
  schema: {}

execution:
  timeoutMs: 30000
  maxAttempts: 2

capabilities:
  model: false
  tools: []
```

## Rules

- manifest contains no plaintext secrets;
- runtime key cannot authorize arbitrary imports;
- input/output schemas are runtime validated;
- AgentVersion stores a manifest snapshot;
- changing executable behavior creates a new AgentVersion.
