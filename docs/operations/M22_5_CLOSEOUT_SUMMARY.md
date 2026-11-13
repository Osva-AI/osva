# M22.5 — Deliverables, Activity, Observability, and Acceptance (A–D)

**Branch:** `feat/m22-5-office-deliverables-activity`
**Milestone slices:** M22.5A deliverables, M22.5B activity, M22.5C observability, M22.5D integrated acceptance
**Status:** Implemented on branch; awaiting human commit, push, combined A–D PR, and hosted `pnpm verify:ci:clean`

Architecture references: [M22_5A_OFFICE_DELIVERABLES.md](../architecture/M22_5A_OFFICE_DELIVERABLES.md), [M22_5B_OFFICE_ACTIVITY.md](../architecture/M22_5B_OFFICE_ACTIVITY.md), [M22_5C_OFFICE_OBSERVABILITY.md](../architecture/M22_5C_OFFICE_OBSERVABILITY.md).

## Deliverables (A–D)

| Slice | Scope |
| --- | --- |
| M22.5A | Workspace deliverables library, mission/task provenance index, Console routes and sections |
| M22.5B | Office Activity feed from persisted assignments, workflow runs, approvals, verified artifacts |
| M22.5C | Mission Control and scoped observability metrics; shared activity feed query on dashboard |
| M22.5D | Real-stack acceptance extension, query-budget harness, mocked browser coverage, closeout docs |

## Real-stack acceptance evidence (M22.5D)

| Scenario | Evidence |
| --- | --- |
| Mission → workflow → Agent A → approval → Agent B → artifact → COMPLETED | `apps/worker/test/integration/m22-5-office-integrated-acceptance.integration.test.ts` (success case) |
| Approval rejection → FAILED assignment, no successor artifact | Same file (rejection case) |
| Direct agent-backed task → artifact, no queue on create | Same file (direct agent case) |
| M22.4 workflow baseline (unchanged) | `apps/worker/test/integration/m22-4-office-workflow-acceptance.integration.test.ts` |
| Inbox `assignmentId` mapping | `packages/db/test/integration/office-inbox-assignment-mapping.integration.test.ts` |
| Domain deliverables, activity, observability | `packages/domain/test/office-*-projection.test.ts` |
| Console adapters and pages | `apps/console/test/office-*.test.ts(x)` |

**Browser vs backend:** `apps/console/test/integration/office-m22-5-browser-acceptance.integration.test.ts` and `office-ui-acceptance.integration.test.ts` use **mocked BFF routes** for layout/navigation. Execution, provenance, and metrics proof is **worker + PostgreSQL + domain** backed.

### Manual full-stack browser checklist (when Playwright mocks are insufficient)

1. Sign in, select a workspace with completed workflow and agent tasks.
2. Open **Mission Control** — verify task counts, recent activity, recent deliverables sections load without errors.
3. Open **Deliverables** — verify artifact rows, task/mission provenance columns, pagination cursor.
4. Open **Activity** — verify task lifecycle, workflow nodes, approval decisions, artifact events; no duplicate rows (mocked Playwright coverage is deliverables + Mission Control only; activity layout is covered by `office-activity-page` unit tests).
5. Open **Inbox** — pending approval links to Task Detail when `assignmentId` is unambiguous.
6. Switch workspace — confirm no cross-workspace data in Office surfaces.

## Security and authorization evidence

| Concern | Evidence |
| --- | --- |
| Workspace isolation (assignments, workers, artifacts) | `apps/web/test/rest-workspace-security-matrix.test.ts` |
| VIEWER read-only Office task UI | `apps/console/test/office-tasks-ui.test.tsx` |
| Activity workspace mismatch | `packages/domain/test/office-activity-projection.test.ts` |
| Foreign assignment exclusion in activity feed | `apps/console/test/office-activity.test.ts` |
| Collaboration HTTP RBAC | `apps/web/test/integration/office-collaboration-acceptance.integration.test.ts` |

Team membership does **not** expand artifact or assignment permissions. Read-only dashboards do not invoke launch, approval, or inference paths.

## Query-count and performance findings (M22.5D)

Console helper `estimateOfficeMissionControlHttpReads` (`apps/console/src/client/lib/office-mission-control-query-budget.ts`) documents **distinct** cold-load GET families when Mission Control includes recent activity/deliverable sections.

| Workload | Distinct workflow-run GETs | Distinct workflow-version GETs | Total distinct GETs (3 teams, recent sections) |
| --- | --- | --- | --- |
| 25 tasks, 0 workflow launches | 0 | 0 | **10** |
| 25 tasks, 5 workflow launches | 5 | 5 | **20** |
| 100 tasks, 20 workflow launches (same distinct runs) | 20 | 20 | **50** |

Assignment list remains **one** GET per workspace scope; fan-out scales with **distinct launched workflow run ids**, not raw task count. TanStack Query dedupes identical keys between Mission Control and `MissionControlRecentSections` (`["office", workspaceId, "assignments"]`, workers, etc.).

**Deferred:** workspace-scoped cost/token rollup (`aggregateRunAttemptUsageBatch` over all Office runs) — rejected for Mission Control per M22.5C data-access gate; requires architecture approval before any new HTTP endpoint.

## Migrations

None for M22.5.

## Local verification (M22.5D session)

Run integration tests direct (uncached config) after `@osva/db` build when repository dist is stale:

```text
pnpm --filter @osva/domain exec vitest run test/office-deliverable-provenance.test.ts test/office-activity-projection.test.ts test/office-observability-projection.test.ts
pnpm --filter @osva/console exec vitest run test/office-deliverables-page.test.tsx test/office-activity.test.ts test/office-observability.test.ts test/office-mission-control-query-budget.test.ts test/office-navigation.test.ts
pnpm --filter @osva/worker exec vitest run --config vitest.integration.config.ts test/integration/m22-5-office-integrated-acceptance.integration.test.ts
pnpm verify:branch -- --profile=integration
```

Hosted obligation after human commit: GitHub Actions clean matrix (`pnpm verify:ci:clean`).

## Known limitations

- Activity artifact events limited to loaded artifact list page (50).
- Agent-backed `FAILED` tasks may omit failure timestamp without workflow terminal time.
- No workspace estimated cost on Mission Control (deferred endpoint).
- Browser E2E does not replace worker integration for deliverable provenance.
- Roadmap table should mark M22.5 merged only after operator merges the combined PR.

## Git / GitHub

AI agents performed **no** git staging, commits, pushes, or GitHub writes during M22.5D.
