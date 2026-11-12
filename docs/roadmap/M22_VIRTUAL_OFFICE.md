# M22 — OSVA Virtual Office

## Milestone map

| Slice | Scope | Status |
| --- | --- | --- |
| **M22.0** | Office foundation audit, workspace/security hardening, REST/SDK parity, execution integration verification, Chat/Inbox architecture (docs only), Console readiness spec | Complete (merged via PR #108) |
| **M22.1** | Virtual Office shell, Mission Control, teams and workers UI | Complete (merged via PR #109) |
| **M22.2A** | Team Chat + Inbox **backend** (threads, messages, read state, inbox projection) | Implemented (awaiting PR) |
| **M22.2B** | Team Chat + Inbox **Console UI** | Planned |
| **M22.3** | Missions, task planning, assignment management UX | Planned |
| **M22.4** | Real worker execution, handoffs, human approvals in Office context | Planned |
| **M22.5** | Deliverables, activity, observability, end-to-end acceptance | Planned |

**M21** remains exclusively the OSVA Website. Do not conflate website work with Virtual Office milestones.

## Product vocabulary ↔ OSVA domain

| Virtual Office term | OSVA entity | Notes |
| --- | --- | --- |
| Worker | `OfficeWorker` | Links to `Agent`; does not execute by itself |
| Team | `Team` + `TeamMembership` | Organizational grouping |
| Role | `Role` | Office metadata; distinct from API RBAC |
| Mission | `Goal` | Workspace-scoped objective |
| Task | `Assignment` | Freezes `AgentVersion` or `WorkflowVersion` at creation |
| Execution | `Run` or `WorkflowRun` | Launch reuses existing orchestration |
| Deliverable | `Artifact` | Via run/workflow outputs |
| Approval | Approval requests / workflow waits | Existing approval plane |

## M22.0 acceptance criteria

1. All Office REST routes enforce workspace isolation on ID-based reads and mutations.
2. `GET /v1/office/assignments/:id` authorizes before reconcile; reconcile is workspace-scoped.
3. `POST .../launch` requires EXECUTE permission and workspace-scoped assignment lookup.
4. `POST .../cancel` remains workspace-scoped (existing `CancelAssignment`).
5. Canonical REST paths are `/v1/office/{workers,roles,teams,goals,assignments}`.
6. TypeScript and Python SDKs target canonical paths (no legacy `/v1/office-workers`, `/v1/teams`, etc.).
7. Assignments do not introduce a competing runtime; launch uses `CreateRun` / workflow runs.
8. No model inference while idle — creating or messaging a worker does not consume tokens.
9. Chat/Inbox architecture documented without premature tables or endpoints.
10. Console integration map for M22.1+ documented.

## M22.1 Console surface (implemented)

### Routes

| Console route | Purpose |
| --- | --- |
| `/office` | Mission Control dashboard |
| `/office/teams` | Team directory and create |
| `/office/teams/:teamId` | Team detail, edit, memberships, roles |
| `/office/workers` | Worker directory and register |
| `/office/workers/:workerId` | Worker profile and edit |

### BFF allowlist (`apps/console/src/server/routes/api.ts`)

Proxied to canonical OSVA paths:

- `GET/POST /api/v1/office/workers` → `/v1/office/workers`
- `GET/PATCH /api/v1/office/workers/:id`
- `GET/POST /api/v1/office/roles` → `/v1/office/roles`
- `GET/PATCH /api/v1/office/roles/:id`
- `GET/POST /api/v1/office/teams` → `/v1/office/teams`
- `GET/PATCH /api/v1/office/teams/:id`
- `GET/POST /api/v1/office/teams/:id/memberships`
- `GET /api/v1/office/assignments` (read-only in UI)

Assignment `launch` / `cancel` and goal mutations are intentionally **not** exposed in M22.1.

### Supported user actions

- View Mission Control metrics from live Office data (workers, teams, assignment status counts).
- Register and edit Office Workers (linked to existing Agents).
- Create and edit Teams; add Office Workers to teams with optional Office Roles.
- Create Office Roles inline from team membership flow.
- Workspace-scoped TanStack Query keys; no cross-workspace cache bleed.

### Known limitations

- No team membership removal (API does not support DELETE).
- No worker presence / online state.
- No Team Chat, Inbox, mission board, or assignment launch UX (later milestones).
- No automatic polling; manual refresh or mutation invalidation only.

### Run locally

1. Start control plane and Console per repo quickstart.
2. Sign in, select a workspace.
3. Open **Virtual Office → Mission Control** at `/office`.

### M22.1 acceptance evidence (agent)

- Console unit tests: `office-mission-control-page.test.tsx`, `office-navigation.test.ts`, `server.test.ts` office BFF cases.
- Full browser E2E against a live stack: **deferred** unless operator runs integration harness locally.

## References

- [M22 Office foundation](../architecture/M22_OFFICE_FOUNDATION.md)
- [M22 Team Chat and Inbox](../architecture/M22_TEAM_CHAT_INBOX.md)
- [M22 Console integration](../architecture/M22_CONSOLE_INTEGRATION.md)
- [AI Office vision](../product/AI_OFFICE_VISION.md)
- [AI Office layer](../platform/AI_OFFICE_LAYER.md)
