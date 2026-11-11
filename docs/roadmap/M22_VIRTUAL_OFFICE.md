# M22 — OSVA Virtual Office

## Milestone map

| Slice | Scope | Status |
| --- | --- | --- |
| **M22.0** | Office foundation audit, workspace/security hardening, REST/SDK parity, execution integration verification, Chat/Inbox architecture (docs only), Console readiness spec | In progress |
| **M22.1** | Virtual Office shell, Mission Control, teams and workers UI | Planned |
| **M22.2** | Team Chat, persistent conversations, unified Inbox | Planned |
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

## References

- [M22 Office foundation](../architecture/M22_OFFICE_FOUNDATION.md)
- [M22 Team Chat and Inbox](../architecture/M22_TEAM_CHAT_INBOX.md)
- [M22 Console integration](../architecture/M22_CONSOLE_INTEGRATION.md)
- [AI Office vision](../product/AI_OFFICE_VISION.md)
- [AI Office layer](../platform/AI_OFFICE_LAYER.md)
