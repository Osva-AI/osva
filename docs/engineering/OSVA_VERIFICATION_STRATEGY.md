# OSVA Verification and CI Strategy

## Status

This document defines the engineering verification strategy for the public OSVA repository. The repository copy should live at `docs/engineering/VERIFICATION_STRATEGY.md` and should be treated as the detailed source of truth for Cursor implementation work.

## Objectives

- Increase first-push success.
- Detect cheap failures before expensive integration runs.
- Keep local work practical on a lower-resource Windows development machine.
- Preserve strong migration, authentication, authorization, and workspace-isolation guarantees.
- Avoid stale-cache false confidence.
- Keep Docker-backed acceptance separate from unit verification.

## Standing constraints

- Cursor must not create branches, stage, commit, push, merge, or tag.
- Repository history and migrations must remain backward-compatible and non-destructive.
- Authentication and authorization default to deny.
- API keys, password hashes, secrets, and session tokens must never appear in logs.
- Existing CLI, SDK, API-key, Compose, and persistence workflows must remain compatible.
- Every workspace-owned query must preserve workspace isolation.
- Prettier `--write` and `--check` are required for every changed supported file.
- Full clean verification must not be repeated for small increments.

## Lessons from recent CI failures

### Formatting omissions

Multiple pushes failed before substantive verification because a changed file had not been formatted. Formatting must happen before lint, typecheck, or integration testing.

### Cross-cutting configuration omissions

Making `OSVA_AUTH_SECRET` mandatory affected web startup, integration harnesses, examples, Compose smoke, deployment acceptance, and Kubernetes acceptance. The initial correction missed the Hello Agent example. Required configuration changes must therefore trigger a full consumer inventory.

### Cached false confidence

Broad local verification can replay cached task results. This is especially risky where examples import application source through relative cross-workspace paths. The affected package integration must be run directly.

### Timing assumptions

Scheduler polling previously used event-loop turns instead of a wall-clock deadline. CI runners and local machines execute such loops at different speeds. All polling must use elapsed time and report the last observed state.

### Queue races

BullMQ idempotency tests exposed assumptions about when a job remains queued, becomes active, completes, or is removed. Queue tests must control consumers with explicit gates and assert OSVA-owned idempotency semantics.

### Brittle migration assertions

Migration tests must locate historical entries by explicit index or tag. They must not use a moving `slice(-N)` window.

### Noisy teardown

Repeated Valkey `ECONNREFUSED` and `EPIPE` messages appear during otherwise passing tests. Clients must close before ephemeral infrastructure stops so logs remain diagnostic.

## OSVA impact inventory

Before changing a shared invariant, search these areas:

- `apps/web`
- `apps/worker`
- `apps/scheduler`
- `apps/workflow-orchestrator`
- `apps/mcp-server`
- `apps/console`
- `apps/identity`
- `packages/contracts`
- `packages/domain`
- `packages/db`
- `adapters`
- `examples`
- `scripts/verification`
- `scripts/deployment`
- `deploy/compose`
- `deploy/helm`
- `.github/workflows`
- Root configuration and environment examples

Use `rg` for constructor names, environment variables, route IDs, contract symbols, table names, migration tags, and exported types.

## Change-impact matrix

| OSVA change | Required focused verification |
| --- | --- |
| Documentation only | Prettier, documentation link checker, patch check |
| Contracts | Contracts lint/typecheck/test plus direct consumers |
| Domain policy | Domain lint/typecheck/test plus relevant adapters or HTTP authorization tests |
| Web route | Web lint/typecheck/unit plus route inventory and focused integration |
| Human authentication | Contracts/domain/web/adapters-auth focused tests plus CSRF, session, and workspace isolation |
| Required web configuration | Search every `createWebProcess`, runtime entry point, Compose, Docker, Helm, Kind, and acceptance script |
| Database schema | Migration verification plus migration acceptance and schema integrity |
| Repository query | Focused PostgreSQL integration plus cross-workspace isolation |
| Queue or worker | Direct BullMQ/worker integration with controlled consumers |
| Scheduler or orchestrator | Direct integration with elapsed-time polling and state diagnostics |
| Compose | `docker compose config` plus focused smoke |
| Helm | Helm lint/template and existing-secret behavior |
| Release packaging | Focused release script tests, then hosted Release Readiness |

## Verification sequence

### During implementation

1. Format changed files.
2. Run affected package lint.
3. Run affected package typecheck.
4. Run focused unit tests.
5. Run the affected package integration directly.
6. Run architecture and inventory tests related to the invariant.

### Slice completion

1. Run changed-file verification once.
2. Run migration verification when applicable.
3. Run a patch whitespace check.
4. Run only relevant Docker-backed acceptance.

### Hosted CI

GitHub Actions remains responsible for the clean full matrix. A local full CI-equivalent run is not required after every small correction if the exact affected package integration passed directly.

## Formatting policy

For every changed supported file:

```powershell
pnpm exec prettier --write <files>
pnpm exec prettier --check <files>
```

Run formatting before expensive verification. Markdown changes also require:

```powershell
node scripts/release/docs-link-check.mjs
```

## Cache policy

- Do not accept a Turbo-cached integration result as the only proof for a changed behavior.
- Run the affected package script directly.
- If a package imports source through a relative workspace path, treat it as a cache-risk boundary.
- Prefer declared workspace dependencies or move reusable helpers into an appropriate package.
- Use clean full verification only when focused uncached evidence remains insufficient.

## Test environment policy

- Integration processes must receive explicit test configuration.
- Web integration processes should use the shared test authentication environment helper.
- Raw test environment objects must not omit mandatory web configuration.
- Test-only secrets must be clearly named and must not become production defaults.
- Tests must not depend on the developer's `.env` file.

An architecture test should reject unapproved raw `createWebProcess({ ... })` calls in integration tests.

## Async and timeout policy

Shared polling helpers must use:

- An elapsed-time deadline
- A 50–200 ms polling interval unless the system needs another cadence
- Last-state capture
- IDs relevant to the operation
- Diagnostic output on timeout

Fixed event-loop iteration counts are prohibited for database, queue, worker, scheduler, or workflow completion.

## Local resource policy

The default local machine profile is resource-constrained relative to hosted CI.

- Keep repository task concurrency at one or two for broad checks.
- Run one Docker-backed package integration at a time.
- Use one Vitest worker or disable file parallelism for suites sharing ephemeral services.
- Do not run multiple broad commands simultaneously.
- Do not repeatedly run `verify:ci:clean`.
- Prefer GitHub Actions for the final clean full matrix.

## Resource lifecycle policy

Tests should stop OSVA processes and clients before infrastructure:

1. Scheduler and producers
2. Workers
3. Queues
4. Redis/Valkey clients
5. Valkey container
6. Database clients
7. PostgreSQL container
8. Temporary filesystem resources

All shutdown operations must be awaited and safe in `finally` blocks.

## Migration policy

- Migrations are append-only once externally applied.
- Fresh migration and upgrade migration paths require acceptance coverage.
- Migration history verification is mandatory after any migration metadata change.
- Historical tests should identify entries by tag or explicit index.
- Migration head assertions should remain separate from historical-window assertions.
- Existing API keys, workspaces, agents, Runs, and workflow data must be preserved.

## Security verification policy

For identity and authorization work, focused evidence must cover:

- Invalid Bearer credentials never fall back to a browser session.
- Browser mutations enforce origin and CSRF requirements.
- Session tokens remain in secure cookies and never appear in JSON.
- Absolute and idle session expiry are both enforced.
- Disabled users cannot authenticate or recover through ordinary flows.
- Organization membership does not imply workspace access.
- Human and API-key authorization remain separate.
- Owner invariants are transactionally protected.
- Cross-workspace access is denied in the API, not merely hidden in the Console.

## Failure triage

On failure:

1. Stop the broad command.
2. Find the first actionable error.
3. Ignore warnings belonging to passing tests.
4. Classify the failure.
5. Run the smallest reproducing command directly.
6. Fix only the confirmed cause.
7. Rerun the focused command.
8. Expand verification only after it passes.

## Expected implementation report

Every Cursor report must include:

1. Files changed.
2. Impact inventory covered.
3. Focused commands and exact results.
4. Whether results were cached.
5. Docker-backed checks run or deferred.
6. GitHub-only checks remaining.
7. Production security and compatibility confirmation.
8. Confirmation that Cursor performed no Git mutations.

## Owner pre-push checklist

The repository owner performs Git operations and should verify:

```powershell
git status --short
git diff --cached --stat
git diff --cached --check
git diff --cached
```

Confirm that the staged commit contains the exact locally verified fix and no unrelated or sensitive files.
