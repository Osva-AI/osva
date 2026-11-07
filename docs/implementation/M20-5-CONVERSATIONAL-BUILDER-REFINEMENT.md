# M20.5 — Conversational builder refinement

## Status

Implemented on branch `feat/m20-5-conversational-builder-refinement`.

## Architecture

```text
Console /workflows/new/describe
  → BFF POST /api/v1/builder/proposals/refine
  → Control plane POST /v1/builder/proposals/refine
  → RefineBuilderProposalFromNaturalLanguage
       ├─ parse + digest verify (expectedBaseProposalDigest)
       ├─ GetWorkspaceBuilderCapabilityCatalog (pinned ids from current proposal)
       ├─ ModelGateway structured JSON (full candidate BuilderProposalV1)
       ├─ validateBuilderProposalModelOutputPipeline (M20.2 reuse)
       └─ compareBuilderProposalChanges (deterministic diff)
```

BuilderProposalV1 remains the source of truth. Model output is untrusted; candidates are never auto-applied in the Console.

## Domain

| Component | Role |
|-----------|------|
| `RefineBuilderProposalFromNaturalLanguage` | Application service |
| `computeBuilderProposalDigest` | Canonical `sha256:` digest via `digestCanonicalJsonValue` |
| `compareBuilderProposalChanges` | Before/after changeset |
| `buildBoundedCapabilityCatalogPayloadForRefinement` | Pins catalog entries referenced by current proposal |
| `validateBuilderProposalModelOutputPipeline` | Shared post-model validation (M20.2 + M20.5) |

### Request / success response

See `RefineBuilderProposalRequestV1` and `BuilderRefinementSuccessV1` in `builder-refinement-types.ts`.

## Console UX

- Refinement panel on existing `/workflows/new/describe` route only.
- **Refine** produces a candidate; graph preview can show candidate topology while draft fields stay on the base proposal until **Accept changes**.
- **Discard** clears the candidate; **Undo last accepted change** pops one revision from session `acceptedRevisions`.
- Session envelope (`builder-nl-draft-storage`) stores bounded history, optional `pendingCandidate`, and preserves M20.3/M20.4 fields.

## Publication safety (M20.4)

- Accepting a refinement or manual registry/agent edit clears prepared publication plan and confirmation and rotates `publicationIdempotencyKey` (new publish intent).
- Refinement disabled when `publicationPhase` is `publishing`, `unknown`, or `published`.
- In-flight / ambiguous publication retains prior idempotency key and receipt recovery (no draft mutation during `publishing` / `unknown`).

## Tests

- Domain: `packages/domain/test/builder-refinement.test.ts`, `compare-builder-proposal-changes.test.ts`
- HTTP: `apps/web/test/builder-http.test.ts` (stale digest)
- Browser: `apps/console/test/integration/m20-5-browser.integration.test.ts` (mocked BFF)

## Limitations

- No server-side conversation database; history is session-scoped only.
- Anthropic generation profiles remain unsupported for structured JSON (same as M20.2).
- Browser tests validate Console UX with deterministic mocked refine responses, not live model behavior.
