# M22.4B — Workflow handoffs and team context

## Build versus reuse

| Need | Reuse | Notes |
| --- | --- | --- |
| WorkflowRun + node rows | `GET /v1/workflow-runs/:id`, `useWorkflowRunQuery` | Same M22.4A payload |
| Definition labels/types | `useWorkflowVersionQuery`, `resolveWorkflowCanvasLabel` | No duplicate graph editor |
| Execution graph (read-only) | `WorkflowGraphView` + React Flow (existing) | Lazy-loaded on Task detail only |
| Edge branch/skip semantics | Mirrors `workflow-node-run-overlay.edgeAppearanceById` rules | Handoff projection in domain is authoritative for Office copy |
| Worker directory | `useOfficeWorkersQuery` | AgentVersion → AgentId → worker attribution unchanged from M22.4A |
| Teams / memberships | `useOfficeTeamsQuery`, `useAllTeamMembershipsQuery`, `useOfficeRolesQuery` | Same fan-out as Worker detail; one fetch per team list, not per node |
| M22.4A timeline | `buildWorkflowExecutionTimeline` | Retained; handoff panel adds graph + edge terminology |

**Not built:** delegation records, synthetic chat handoffs, new APIs, approval decision UI, mission-wide graph aggregation.

## Handoff semantics

| Concept | Rule |
| --- | --- |
| **Defined connection** | Edge exists on pinned WorkflowVersion; no persisted proof the path ran |
| **Executed workflow step** | Persisted target WorkflowNodeRun exists with non-`PENDING` status and source allows handoff |
| **Selected branch** | BRANCH `selectedTargetKey` matches edge target with traversal evidence |
| **Skipped step** | Persisted `SKIPPED` on target, or inactive branch arm |
| **Failed path** | Source `FAILED`; downstream completion is not assumed |
| **Waiting for approval** | APPROVAL node `WAITING` + ApprovalRequest row |

Topology alone never marks an edge executed. BRANCH decisions require `selectedTargetKey`.

## Projection I/O

**Inputs:** `workspaceId`, workflow node defs (key, type, optional `agentVersionId`), edges, `WorkflowNodeRun` rows (incl. `selectedTargetKey`), `ApprovalRequest` rows, AgentVersion catalog index, OfficeWorker index, optional team/role/membership indexes.

**Outputs:** `OfficeWorkflowHandoffProjection` — node views (step kind, attribution, optional team context), edge views (kind + terminology label), `executionStatusByNodeKey` for graph overlay, optional `blockingNodeKey`.

Package export: `@osva/domain/office-execution-context` (`buildOfficeWorkflowHandoffProjection`).

## Worker attribution and team context

Unchanged M22.4A rules for AGENT nodes (`RESOLVED` / `AMBIGUOUS_WORKERS` / `NO_REGISTERED_WORKER`).

Team rows are **organizational context only** — membership does not prove node ownership or grant authorization.

## Authorization and security

Same READ matrix as M22.4A. Projection throws on workspace mismatch. No prompts, tool payloads, or secrets in handoff views.

## Data freshness and query cost

| Surface | Typical calls (incremental to M22.4A) |
| --- | --- |
| Task (workflow) | + teams list + roles list + one membership request per team (cached 60s) |

No per-node network calls. Agent version catalog still gated on non-skipped node runs.

## Mission detail

Concise copy only: handoff graphs stay on Task detail to avoid N+1 WorkflowRun fetches across mission tasks.

## Known limitations

- Graph overlay requires definition schema version 3 (same as WorkflowRun detail).
- Sequential V1/V2 workflows show timeline + edge list without canvas overlay.
- Explicit `officeWorkerId` on AGENT nodes remains deferred (M22.4A).

## Dependencies

- **M22.4C:** Implemented — see `M22_4C_HUMAN_APPROVALS.md` (Task approval section; Inbox → Task navigation).
- **M22.4D:** Combined verification gate after full M22.4 slice.
