# M20.4 â€” Safe agent & workflow publication

## Scope

Transforms a validated `BuilderProposalV1` into immutable workspace agents (`Agent` + `AgentVersion` v1) and a new workflow (`Workflow` + `WorkflowVersion` v1) through an explicit, idempotent, auditable control-plane write path. **No** workflow execution, model calls, or tool invocations during publication.

## Package ownership

| Layer | Location |
|--------|-----------|
| Preflight & publish orchestration | `@osva/domain/builder` (`PrepareBuilderPublication`, `PublishBuilderProposal`, `GetBuilderPublicationReceipt`) |
| Atomic persistence | `@osva/db` (`PostgresBuilderPublicationRepository`, `builder_publications` table, migration `0032_builder_publication_slice`) |
| HTTP | `apps/web/src/builder-http.ts` |
| Console BFF | `apps/console/src/server/routes/api.ts` |
| NL builder UX | `apps/console/src/client/routes/workflow-nl-builder-page.tsx` |

## Lifecycle

1. **Prepare** (`POST /v1/builder/publications/prepare`) â€” read-only: catalog load, `compileBuilderProposalPrePublication`, registry conflict checks, deterministic `planDigest`. Requires agent **and** workflow **WRITE** in domain (HTTP POST defaults to WRITE).
2. **Confirm** â€” client sends `expectedPlanDigest`, stable `idempotencyKey`, `confirm: true`, optional `acknowledgeUnresolvedRequirements`.
3. **Publish** (`POST /v1/builder/publications`) â€” domain re-validates digest, extends catalog index with pending NEW `AgentVersionId`s, `compileBuilderProposalResolved`, then **one PostgreSQL transaction** via `publishAtomically`.
4. **Receipt** (`GET /v1/builder/publications/:publicationId`) â€” workspace-scoped read of persisted receipt JSON.

## Transaction boundary (atomicity proof)

**Verified:** `PostgresAgentRepository.appendAgentVersion` and `PostgresWorkflowRepository.appendWorkflowVersion` each open **separate** `database.db.transaction` callbacks. Sequential application calls are **not** multi-resource atomic.

**M20.4 boundary:** `PostgresBuilderPublicationRepository.publishAtomically` runs a **single** transaction that inserts, in order:

1. NEW `agents` rows
2. NEW `agent_versions` rows (version 1)
3. NEW `workflows` row
4. NEW `workflow_versions` row (version 1)
5. `builder_publications` receipt row
6. `security_audit_events` (`builder.publication_succeeded`)

Failure at any step rolls back the entire transaction (integration evidence: injected `beforeWorkflowPersisted` hook â†’ no orphan agents/workflows).

## Idempotency

- Unique constraint: `(workspace_id, idempotency_key)` on `builder_publications`.
- Same key + same `planDigest` â†’ replay committed receipt (`200`, `replay: true`).
- Same key + different digest â†’ `BuilderPublicationIdempotencyConflictError` â†’ HTTP `409`.
- Concurrent same-key: row lock / unique violation â†’ reconcile to single publication.

## Plan digest

Computed server-side by `computeBuilderPublicationPlanDigest` from workspace id, publication mode `CREATE_NEW_WORKFLOW_V1`, and canonicalized proposal content. Browser-supplied digests are never trusted.

## Deferred (M20.5+)

- Updating existing agents / appending workflow versions
- Bulk publication
- Automatic runs after publish

## Verification (this branch, uncommitted)

- `@osva/domain` `test/builder-publication.test.ts` (5)
- `@osva/db` `test/integration/builder-publication.integration.test.ts` (2)
- `apps/web/test/builder-http.test.ts` (extended)
- Builds: `@osva-ai/contracts`, `@osva/domain`, `@osva/db`, `@osva/web`

`verify:pre-push` **not** run (uncommitted tree â€” owner runs after commit).
