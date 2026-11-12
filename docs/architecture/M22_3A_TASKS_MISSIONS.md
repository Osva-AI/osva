# M22.3A — Tasks and Missions Foundation

## Domain mapping (reuse, no new entities)

| Product term | OSVA domain | Execution |
| --- | --- | --- |
| Mission | `Goal` | Manual `Goal.status` only |
| AI Task | `Assignment` | `Run` or `WorkflowRun` after launch |
| Task executor | `OfficeWorker` | Via worker `agentId` / workflow version |
| Launch | `POST .../assignments/:id/launch` | `LaunchAssignment` → queue/run |

Assignment creation (`POST /v1/office/assignments`) persists `PENDING` only — no execution is enqueued.

## API parity

| Capability | Upstream `apps/web` | Console BFF `apps/console` |
| --- | --- | --- |
| List missions | `GET /v1/office/goals` | `GET /api/v1/office/goals` |
| Create mission | `POST /v1/office/goals` | `POST /api/v1/office/goals` |
| Mission detail | `GET /v1/office/goals/:id` | `GET /api/v1/office/goals/:id` |
| Update mission | `PATCH /v1/office/goals/:id` | `PATCH /api/v1/office/goals/:id` |
| List tasks | `GET /v1/office/assignments` | `GET /api/v1/office/assignments` |
| Create task | `POST /v1/office/assignments` | `POST /api/v1/office/assignments` |
| Task detail | `GET /v1/office/assignments/:id` (reconcile) | `GET /api/v1/office/assignments/:id` |
| Update task metadata | `PATCH /v1/office/assignments/:id` | `PATCH /api/v1/office/assignments/:id` |
| Launch task | `POST .../launch` (EXECUTE) | `POST .../launch` |
| Cancel pending task | `POST .../cancel` (EXECUTE) | `POST .../cancel` |

SDK paths (`packages/sdk`, Python) already match upstream; Console proxies via `ConsoleOsvaClient` / human-session client.

## Authorization matrix

Enforced on upstream `OfficeApplication` and launch HTTP policy (`v1-route-authorization-policy`).

| Role | READ | WRITE (create/edit mission & task metadata) | EXECUTE (launch/cancel) |
| --- | --- | --- | --- |
| VIEWER | Yes | No | No |
| OPERATOR | Yes | No | Yes |
| DEVELOPER | Yes | Yes | Yes |
| ADMIN / OWNER | Yes | Yes | Yes |

`updateAssignmentRequestSchema` does not expose `status`; RUNNING/COMPLETED/FAILED cannot be set through PATCH. Cancel is limited to `PENDING` in domain.

## Mission progress (presentation)

`apps/console/src/client/lib/mission-progress.ts`:

- `computeMissionProgress(goalId, assignments)` — counts linked assignments by state and `completedRatio`.
- Does not persist counters or auto-transition `Goal.status`.
- Assignments without `goalId` are **unassigned tasks** (`unassignedTasks()`); they appear on task boards but not in mission progress.

## Execution lifecycle and freshness

| Endpoint | Reconciliation |
| --- | --- |
| `GET .../assignments/:id` | Yes — derives status from linked Run/WorkflowRun after READ auth |
| `GET .../assignments` | No — persisted rows only |

**M22.3C deferred:** list/board freshness may lag for RUNNING tasks until detail fetch, polling, or a bounded list-reconcile strategy is designed (avoid blind N+1).

## React Query

Hooks live in `apps/console/src/client/hooks/use-office.ts`:

- Workspace-scoped keys: `["office", workspaceId, "goals" | "assignments", ...]`.
- Mutations pin `workspaceId` at `mutationFn` start via `workspaceMutationFetch(..., { workspaceId })`.
- Invalidates goals, assignments, and inbox queries under the workspace after mission/task mutations.

## Dependencies

| Slice | Depends on M22.3A |
| --- | --- |
| M22.3B | Task board UI consuming hooks + list endpoints |
| M22.3C | List reconciliation / freshness for boards |
| M22.4+ | Worker observability, richer mission control UI |

## Human tasks

HumanTask persistence and delegation are **out of scope** (M22.3A). Human approval flows remain workflow state.

## Migrations

None. Reuses existing Goal/Assignment tables and office repository.
