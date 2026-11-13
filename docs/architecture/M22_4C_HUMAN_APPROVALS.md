# M22.4C — Human approvals in Virtual Office

## Build versus reuse

| Need | Reuse | Notes |
| --- | --- | --- |
| Approval authority | `ApprovalRequest`, `DecideApprovalRequest`, state machine | No `OfficeApproval` entity |
| Decision API | `POST /v1/approval-requests/:id/decision` via Console BFF | Same as WorkflowRun detail |
| Decision mutation | `useApprovalDecisionMutation` | Extended invalidation for Office caches |
| Approval UI actions | `WorkflowApprovalActions` | Shared on Task detail and WorkflowRun detail |
| Workflow payload | `GET /v1/workflow-runs/:id` (`approvalRequests`, `nodeRuns`) | Same as M22.4A/B |
| Definition copy | Pinned `WorkflowVersion` APPROVAL `title` / `description` | No duplicate approval config |
| Inbox projection | `buildApprovalInboxItem`, `ListInbox` | Optional `assignmentId` when 1:1 `workflowRunId` match |
| M22.4A timeline / handoffs | `buildWorkflowExecutionTimeline`, handoff projection | Approval rows link to Task approval section |

**Not built:** second approval engine, autonomous approval, synthetic actors, optimistic workflow completion, mission-wide WorkflowRun fan-out.

## Data flow

```text
Task Detail (workflow-backed Assignment)
  → useOfficeAssignmentQuery + useWorkflowRunQuery + useWorkflowVersionQuery
  → @osva/domain buildOfficeWorkflowApprovalViews
  → TaskWorkflowApprovalSection → WorkflowApprovalActions
  → POST /api/v1/approval-requests/:id/decision
  → invalidate workflow run + office assignments + inbox (workspace-scoped)

Unified Inbox
  → listInbox (approval rows + assignmentId join on workflowRunId)
  → OfficeInboxItemRow (decide + link to Task when assignmentId present)

Mission Detail
  → useOfficeAssignmentsQuery + useOfficeInboxQuery (cached)
  → filter APPROVAL_PENDING for linked workflowRunIds only (inbox-backed, not exhaustive)
```

Orchestration continues the workflow after a durable approval transition; the UI does not assume immediate `COMPLETED` on the Assignment.

## Task ↔ ApprovalRequest linkage

- Assignment stores `workflowRunId` after launch.
- `ApprovalRequest.workflowRunId` must match for context on Task detail.
- `ApprovalRequest.workflowNodeRunId` binds to the APPROVAL `WorkflowNodeRun`.
- Inbox adds `assignmentId` only when exactly one assignment in the workspace references that `workflowRunId` (first stable match in repository listing).

## Decision authorization

- Backend: `DecideApprovalRequest` requires `EXECUTE` on approval resource; workspace scoping; operation binding; audit on transition; idempotent return when status already matches decision.
- Console: `roleCanExecuteControlPlaneActions` gates buttons; VIEWER sees read-only copy.
- Team membership and Task visibility do not substitute for approval `EXECUTE`.

## Workflow continuation semantics

| Layer | Meaning |
| --- | --- |
| `ApprovalRequest.status` | Human decision (PENDING / APPROVED / REJECTED) |
| `WorkflowNodeRun.status` | Persisted node execution |
| `WorkflowRun.status` | Overall workflow lifecycle |
| `Assignment.status` | Office reconcile lifecycle |

Successful decision mutation refetches canonical execution data only; no optimistic assignment completion.

## Cache invalidation

On approval decision success (workspace-pinned):

- `["workflow-runs", workspaceId, workflowRunId]`
- `["workflow-runs", workspaceId, "list"]`
- `["office", workspaceId, "assignments"]`
- `["office", workspaceId, "assignments", assignmentId]` when Task context known
- `["office", workspaceId, "inbox"]`

## Security

- Approval titles, descriptions, and comments render as plain text (React children).
- No GET decisions; human session required for mutations.
- Cross-workspace IDs rejected server-side; projection throws on workspace mismatch in domain builders.
- No prompts, tool payloads, or secrets in approval surfaces.

## Known limitations

- Mission approval list is inbox-projection scoped (pending only); not a full mission fan-out.
- Multiple assignments per `workflowRunId` are not supported for inbox `assignmentId` attribution.
- Resolved approvals disappear from inbox; history remains on WorkflowRun and Task approval section until refetch.

## M22.4D dependencies

- Combined verification gate (`verify:ci:clean`) after full M22.4 slice.
- Any remaining browser acceptance for end-to-end approval → workflow progression under live orchestration.
