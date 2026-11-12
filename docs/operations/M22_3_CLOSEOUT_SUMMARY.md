# M22.3 — Tasks and Missions closeout (A–D)

**Branch:** `feat/m22-3-tasks-missions`
**Milestone slices:** M22.3A foundation, M22.3B missions UI, M22.3C task board/detail/controls, M22.3D acceptance and hardening

## Scope delivered

| Slice | Scope |
| --- | --- |
| M22.3A | Goal↔Mission and Assignment↔Task API/BFF parity, authorization, hooks |
| M22.3B | Missions list/detail/create, mission progress presentation |
| M22.3C | Task board, task create/detail, launch/cancel, deliverables section |
| M22.3D | List reconciliation for board freshness, acceptance tests, closeout docs |

## Routes

### Upstream (`apps/web`)

- `GET/POST/PATCH /v1/office/goals`, `GET/PATCH /v1/office/goals/:id`
- `GET/POST/PATCH /v1/office/assignments`, `GET/PATCH /v1/office/assignments/:id`
- `POST /v1/office/assignments/:id/launch`, `POST .../cancel`

### Console BFF

- Mirrored under `/api/v1/office/...` via `ConsoleOsvaClient` / human session

### Console UI

- `/office/missions`, `/office/missions/new`, `/office/missions/:missionId`
- `/office/tasks`, `/office/tasks/new`, `/office/tasks/:taskId`

## Domain mapping

| Product | Domain | Execution |
| --- | --- | --- |
| Mission | `Goal` | Manual status only |
| Task | `Assignment` | `Run` or `WorkflowRun` after launch |
| Worker | `OfficeWorker` | Version frozen at task creation |

## Authorization

| Role | READ | WRITE | EXECUTE |
| --- | --- | --- | --- |
| VIEWER | Yes | No | No |
| OPERATOR | Yes | No | Yes |
| DEVELOPER | Yes | Yes | Yes |
| ADMIN / OWNER | Full | Full | Full |

Enforced on upstream `OfficeApplication` and HTTP policy; Console gates buttons with `roleCanWriteControlPlaneResources` / `roleCanExecuteControlPlaneActions`.

## Execution and reconciliation (M22.3D)

- **Create:** `POST .../assignments` persists `PENDING` only (no queue).
- **Launch / cancel:** Existing orchestration; EXECUTE required.
- **`GET .../assignments/:id`:** Read auth, then `ReconcileAssignment.execute`.
- **`GET .../assignments`:** Read auth, then `ReconcileAssignment.executeList` — reconciles **non-terminal** rows only, loading linked runs/workflow runs by **deduplicated execution ids**, persisting legal transitions.

Board polling (`pollListWhenRunning`) now reflects terminal status without opening Task Detail.

## Mission progress

Client-only `computeMissionProgress` from linked assignments; does not auto-complete missions.

## Artifacts / deliverables

Task Detail uses `RunArtifactsSection` / workflow artifact hooks with workspace-scoped APIs; no inference from `COMPLETED` alone.

## Test evidence (M22.3D)

| Area | Evidence |
| --- | --- |
| List reconcile unit | `packages/orchestration/test/reconcile-assignment.test.ts` |
| List reconcile integration | `apps/worker/test/integration/stage-2-9b-assignment.integration.test.ts` (list GET to terminal) |
| Console Office journey | `apps/console/test/integration/console-office-acceptance.integration.test.ts` |
| Security matrix | `apps/web/test/rest-workspace-security-matrix.test.ts` |
| Console UI (tasks) | `apps/console/test/office-tasks-ui.test.tsx`, `office-missions-ui.test.tsx` |
| Browser (mock BFF) | `apps/console/test/integration/m22-3-tasks-missions-browser.integration.test.ts` |

## Migrations

None for M22.3.

## Deferred / non-goals

HumanTask entity, task DAGs, in-flight cancellation, WebSocket push, autonomous planning, M22.4/M22.5 scope (see `docs/architecture/M22_3A_TASKS_MISSIONS.md`).

## Known limitations

- List reconcile performs one load per unique linked run/workflow run id (bounded by active tasks, not per-row N+1 on terminal rows).
- Real execution browser tests remain Docker/integration-heavy; mock browser suite validates navigation only.

## Release blockers

None identified in M22.3D engineering pass pending human `pnpm verify:branch` / CI clean gate.
