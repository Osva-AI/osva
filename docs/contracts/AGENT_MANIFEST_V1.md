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
  type: TRUSTED_TYPESCRIPT
  entrypoint: echo-agent.ts
  integrity: sha256:<hex>

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

`BUILTIN_PACKAGE` remains valid for in-process test runtimes:

```yaml
runtime:
  type: BUILTIN_PACKAGE
  key: example-agent
```

## Trusted TypeScript runtime

`TRUSTED_TYPESCRIPT` identifies an operator-installed TypeScript file beneath
`OSVA_TRUSTED_RUNTIME_ROOT`.

- `entrypoint` is a relative POSIX path. Absolute paths, `..` traversal,
  backslashes, inline source, shell commands, and package-install requests are
  rejected.
- `integrity` is `sha256:` followed by 64 hex characters. Execution hashes the
  resolved entrypoint file and fails if the digest differs. OSVA does not
  update the stored digest.
- Timeout is the existing `execution.timeoutMs` field (minimum 100ms, maximum
  300000ms). It is immutable with the AgentVersion.

This is a trusted-code descriptor, not remote code upload. Creating an
AgentVersion does not copy files into the runtime root.

If the entrypoint imports other local or package code, dependency immutability
is an operator responsibility in this Community Alpha slice. The digest covers
the declared entrypoint artifact only.

## Model bindings

An AgentVersion may declare named logical model bindings:

```yaml
models:
  primary:
    modelProfileVersionId: mpv_...
```

Binding names start with a letter and may contain letters, digits, `_`, or `-`
(at most 64 characters). They are OSVA identifiers, not provider model IDs.

AgentVersions without `models` remain valid. CreateRun freezes declared
bindings into `Run.effectiveBindings.modelProfileVersionBindings`. Runtime
execution uses that persisted snapshot and does not re-resolve the
AgentVersion or pick a later ModelProfileVersion.

Appending an AgentVersion validates that each referenced ModelProfileVersion
exists in the same Workspace. It does not call the external model provider.

## Rules

- manifest contains no plaintext secrets;
- runtime key cannot authorize arbitrary imports;
- input/output schemas are runtime validated;
- AgentVersion stores a manifest snapshot;
- changing executable behavior creates a new AgentVersion.
