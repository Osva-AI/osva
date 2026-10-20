# ADR-009: Declarative Agent Runtime Descriptor (M13.1A)

**Status:** Accepted for Milestone 13.1 Slice A

## Context

Community Edition will support code-optional agent creation. Non-technical users
need a strict, versioned configuration surface that reuses existing AgentVersion
binding maps, capability grants, and execution lifecycle without introducing a
parallel manifest or orchestration engine.

## Decision

Add `runtime.type: DECLARATIVE` to Agent Manifest v1 with a nested
`runtime.config` object (`configVersion: "1"`). Declarative agents are first-class
AgentVersions: immutable snapshots, existing append validation for referenced
ModelProfileVersion and ToolVersion rows, and existing CreateRun effective-binding
freezing.

Execution is **out of scope** for M13.1A. Workers without a declarative
`RuntimeAdapter` fail closed with `UNSUPPORTED_RUNTIME`, matching other unregistered
runtime types. No fake production executor is registered in this slice.

## Non-goals (M13.1A)

- Console Agent Studio UI
- Declarative executor / loop implementation (M13.2)
- Runtime Protocol V1 changes
- Database migration (manifest remains JSON on `agent_versions`)
- Dynamic plugin registry or arbitrary executable configuration in the manifest

## Declarative versus code-based agents

| Aspect | Code-based (`TRUSTED_TYPESCRIPT`, `CONTAINER`, …) | Declarative (`DECLARATIVE`) |
| --- | --- | --- |
| Behavior source | Operator-supplied executable artifacts | Natural-language instructions + bounded budgets |
| Model/tools | Optional binding maps + capabilities | Required logical model binding; explicit allowed tool bindings |
| Trust boundary | Operator-installed code / images | OSVA-mediated ModelGateway and ToolGateway only (future executor) |
| Execution | Registered `RuntimeAdapter` | Deferred to M13.2; fails closed until then |

`BUILTIN_PACKAGE` remains the in-process test runtime and is **not** overloaded
for declarative configuration.

## Runtime selection

```text
AgentVersion.manifest.runtime.type === "DECLARATIVE"
  → RuntimeDispatcher (no adapter in M13.1A)
  → UNSUPPORTED_RUNTIME at ExecuteRunAttempt
```

Workflow nodes do not select runtimes. Runtime choice stays on the immutable
AgentVersion.

## Configuration surface (`runtime.config` v1)

- `instructions` — required non-empty natural language (no executable fields).
- `modelBinding` — required name referencing `manifest.models`.
- `allowedToolBindings` — explicit list referencing `manifest.tools` (may be empty).
- `maxModelInvocations` — finite bound (1–32 in M13.1A).
- `maxToolInvocations` — finite bound (0–64; must be `0` when no tools allowed).
- `maxOutputTokens` — optional cap (1–16384).

Binding maps (`models`, `tools`, `memory`, `knowledge`), I/O schemas,
`execution`, and `capabilities` remain top-level manifest fields. The declarative
config references those maps; it does not duplicate them.

## Binding and permission enforcement

Schema validation (Zod + cross-field refine) enforces:

- `capabilities.model === true`
- `modelBinding` exists in `manifest.models`
- each allowed tool binding exists in `manifest.tools`
- each allowed tool binding appears in `capabilities.tools` (grant list)
- no duplicate entries in `allowedToolBindings`
- unknown `runtime.config` fields rejected (`strictObject`)

Append-time domain validation continues to verify ModelProfileVersion and
ToolVersion rows exist in the workspace. External providers are not called at
append.

## Execution budget model

Budget fields cap future declarative loops (M13.2). They do not grant unbounded
model or tool calls. Combined with `execution.timeoutMs` and existing RunAttempt
attempt limits, they bound cost and side effects.

## Versioning and immutability

- Manifest `schemaVersion` remains `"1"`.
- Declarative payload is versioned by `runtime.config.configVersion` (`"1"` only in M13.1A).
- Behavior changes require a new AgentVersion; stored manifests are never mutated.

## Trust boundaries

- No shell, script, or network endpoints in declarative config.
- No plaintext secrets in the manifest.
- Tool permissions remain policy-mediated via `capabilities.tools`; prompts/instructions
  cannot grant tools.
- Future execution must route model, tool, and memory access through existing gateways.

## Compatibility and migration

- Existing manifest documents parse unchanged.
- Adding `DECLARATIVE` to `AGENT_RUNTIME_TYPES` is additive for TypeScript consumers.
- REST payloads use the same AgentVersion create schema; invalid declarative manifests
  receive `400 invalid_request` like other schema failures.
- PostgreSQL JSON storage requires no migration.

## Deferred work

| Slice | Responsibility |
| --- | --- |
| M13.2 | Declarative `RuntimeAdapter`, budget enforcement at execution, gateway integration |
| M13.3 | Console Studio for declarative authoring and validation UX |
