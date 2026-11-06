# ADR-010: Builder proposal contract and deterministic compiler (M20.1)

## Status

Accepted — M20.1 (Natural-Language Builder Foundation)

## Context

OSVA needs an internal, deterministic path from **model-produced intent** (future NL generation) to **editable** agents and Workflow V3 graphs without inventing immutable `AgentVersionId` values before publication. Published contracts remain `AgentManifestV1` and `WorkflowDefinitionV3` under `@osva-ai/contracts`; this slice must not broaden the published API.

## Decision

1. **Internal contract `BuilderProposalV1` (schema version `1`)** lives in the private `@osva/domain` package under the **`@osva/domain/builder`** export. It is validated with deterministic structural checks (`parseBuilderProposalV1`) and is **not** re-exported from `@osva-ai/contracts`.

2. **Workspace capability catalog** (`GetWorkspaceBuilderCapabilityCatalog`) reads only workspace-scoped registry data via existing repositories and **control-plane READ** authorization. Serialization is allowlisted: ids, keys, names, version numbers, provider/model strings, and tool type — **no** credentials, connection payloads, MCP transport config, or environment.

3. **Deterministic compilation** is implemented as pure functions (`compileBuilderProposalPrePublication`, `compileBuilderProposalResolved`) that:
   - **Pre-publication (phase 1):** resolve model/tool/catalog bindings, compile NEW agents to `AgentManifestV1` with `runtime.type === "DECLARATIVE"`, validate manifests with `validateAgentManifest`, then validate **logical** graph topology (DAG structure, reachability) using temporary AGENT node shapes that **omit** `agentVersionId` — no `WorkflowDefinitionV3` with placeholder ids; emit a stable **`previewLogicalWorkflowDigest`** over canonical logical nodes + edges.
   - **Resolved (phase 2):** require a complete `ref → AgentVersionId` map for every workflow AGENT ref; every resolved id must appear in the indexed catalog; produce canonical `WorkflowDefinitionV3` (sorted edges) and validate with domain + `workflowDefinitionV3Schema`.

4. **Diagnostics** use a small typed `BuilderIssueV1` (`code`, `severity`, `message`, optional `action`, `location`) with stable sort order for reproducible output.

## Trust boundary

| Layer | Trust |
|--------|--------|
| Proposal JSON | Untrusted structure; validated by schema only |
| Workspace id in `ControlPlaneScope` | Authoritative for catalog reads |
| Ids embedded in proposal content | Untrusted until matched against catalog |
| Compiled manifest / workflow | Trusted only after validation passes |

Publication (creating `AgentVersion` / `WorkflowVersion` rows) remains a separate control-plane write path (expected M20.4).

## Deferred (explicit)

- Natural-language / LLM generation, Console wiring, conversational editing
- Publication and execution changes
- Public HTTP or SDK surface for proposals
- Enterprise governance beyond existing control-plane authorization

## M20.1 acceptance criteria mapping

See implementation in `packages/domain/src/builder/*` and tests in `packages/domain/test/builder-application.test.ts`.

## Verification evidence

Recorded in the final report for this change: Prettier, ESLint, TypeScript, and focused Vitest for `@osva/domain`.
