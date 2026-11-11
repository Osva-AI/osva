# M22.0 — Office foundation and security

## Reusable capabilities (verified in repo)

| Area | Location | Role |
| --- | --- | --- |
| Domain model | `packages/domain` — `OfficeWorker`, `Team`, `Role`, `Goal`, `Assignment` | Workspace-scoped entities and `OfficeApplication` commands |
| Persistence | `packages/db` — office schema, `PostgresOfficeRepository` | Canonical lifecycle storage |
| HTTP API | `apps/web/src/office-http.ts` | `/v1/office/*` REST surface |
| Launch / reconcile | `packages/orchestration` — `LaunchAssignment`, `ReconcileAssignment` | Bind assignments to `Run` / `WorkflowRun` |
| Authorization | `OfficeApplication` + `v1-route-authorization-policy` | `OFFICE` resource; launch/cancel = EXECUTE |
| SDKs | `packages/sdk`, `sdks/python` | HTTP clients (paths aligned in M22.0) |
| Tests | `office-application.test.ts`, `launch-assignment.test.ts`, `rest-workspace-security-matrix.test.ts` | Unit and cross-workspace matrix |

## Execution flow (intended)

```text
Goal (optional) → Assignment (PENDING)
  → POST .../launch (EXECUTE)
    → immutable targetVersionId + officeWorker.agentId
    → CreateRun OR WorkflowRun.create
    → Assignment RUNNING
  → GET .../:id (READ + reconcile)
    → derive status from Run / WorkflowRun terminal state
  → Artifacts via existing run/workflow artifact paths
```

Assignments never enqueue a separate “assignment worker.” BullMQ remains run/workflow transport only.

## Security corrections (M22.0)

### Assignment GET

Previously `GET /v1/office/assignments/:id` called `ReconcileAssignment` with only an assignment ID, bypassing `GetAssignment` workspace authorization.

**Fix:** `getAssignment.execute(scope, id)` first; reconcile requires `workspaceId` from the authenticated principal.

Reconcile may transition assignment state on GET (by design — refresh from linked run). It only runs after authorization and workspace-scoped lookup.

### Assignment launch

Previously `LaunchAssignment` used `findAssignmentById` without workspace or explicit HTTP-layer EXECUTE check.

**Fix:** `authorizeControlPlaneExecute(..., office)` at HTTP boundary; `LaunchAssignment` uses `findAssignmentByWorkspaceAndId`.

### Cancellation

`CancelAssignment` already used workspace-scoped lookup and EXECUTE — no change required.

## Gaps and deferred scope

| Item | Priority | Owner slice |
| --- | --- | --- |
| OfficeWorker → run step attribution in observability UI | P1 | M22.4 / M22.5 |
| Mission Control dashboards | P1 | M22.1 |
| Chat / Inbox persistence | P1 | M22.2 (design in separate doc) |
| HumanTask entity (vision doc) | P2 | TBD — may map to approval + assignment |
| Worker “online” presence | P2 | M22.1+ (must not imply continuous inference) |

## REST ↔ SDK parity matrix

| Resource | Server | TypeScript SDK | Python SDK | Console BFF (M22.0) |
| --- | --- | --- | --- | --- |
| Workers | `/v1/office/workers` | `/v1/office/workers` | `/v1/office/workers` | Not wired (M22.1) |
| Roles | `/v1/office/roles` | `/v1/office/roles` | `/v1/office/roles` | Not wired |
| Teams | `/v1/office/teams` | `/v1/office/teams` | `/v1/office/teams` | Not wired |
| Goals | `/v1/office/goals` | `/v1/office/goals` | `/v1/office/goals` | Not wired |
| Assignments | `/v1/office/assignments` | `/v1/office/assignments` | `/v1/office/assignments` | Not wired |

No duplicate legacy route trees on the server.

## Zero inference while idle

Invariant: persisting an `OfficeWorker` or sending human chat data does not schedule model calls. Only authorized **launch** paths (`POST .../launch`, `POST /v1/runs`, workflow runs) enqueue execution.
