# M22.5B — Virtual Office Activity

## Build versus reuse

| Requirement | Existing capability | M22.5B approach |
| --- | --- | --- |
| Assignment lifecycle | `OfficeAssignmentResource` timestamps | Reuse `createdAt`, `startedAt`, `completedAt`, `cancelledAt` |
| Workflow steps | M22.4A `buildWorkflowExecutionTimeline` inputs | Reuse persisted `WorkflowNodeRun` + approvals from WorkflowRun GET |
| Human approvals | M22.4C `ApprovalRequest` rows | Separate activity entries at `createdAt` / `decidedAt` |
| Deliverables | M22.5A provenance index | Artifact page + verified task association only |
| Worker attribution | M22.4A `resolveWorkflowNodeWorkerAttribution` | Reuse; ambiguous → task owner only |
| Platform Activity (`/activity`) | Run/WorkflowRun list by `createdAt` | **Not reused** — Office feed is task-centric |
| General event store | — | **Not built** |

## Event provenance and timestamp rules

| Activity type | Authoritative record | Timestamp field |
| --- | --- | --- |
| Task created | `Assignment` | `createdAt` |
| Task started | `Assignment` | `startedAt` |
| Task completed | `Assignment` | `completedAt` when `status === COMPLETED` |
| Task cancelled | `Assignment` | `cancelledAt` |
| Task failed | `Assignment` + optional `WorkflowRun` | `WorkflowRun.completedAt` when failed workflow reconcile; otherwise **omitted** (no `updatedAt` inference) |
| Workflow node started | `WorkflowNodeRun` | `startedAt` |
| Workflow node completed/failed/skipped | `WorkflowNodeRun` | `completedAt` with terminal `status` |
| Approval requested | `ApprovalRequest` | `createdAt` |
| Approval approved/rejected | `ApprovalRequest` | `decidedAt` |
| Artifact created | `Artifact` | `createdAt` with M22.5A verified task link |

`updatedAt` is never used as a lifecycle transition timestamp.

## Office versus platform activity boundaries

- `/activity` — bounded recent **Run / WorkflowRun creation** lists (platform execution).
- `/office/activity` — Office tasks, workflow steps, approvals, and **verified** deliverables.
- No synthetic handoffs, prompts, model output, or tool payloads in descriptions.

## Deduplication and ordering

- Stable entry `id` per source fact (`assignment:{id}:created`, `workflow-node:{id}:terminal:FAILED`, …).
- `mergeOfficeActivityEntries` dedupes by `id`.
- Sort: `occurredAt` descending → activity type rank → `id`.
- Missing `occurredAt` sorts last (never fabricated).

## Data-access design gate

**Outcome: No new backend read model.**

Workspace feed composes:

1. `GET /v1/office/assignments` (task lifecycle).
2. `GET /v1/workflow-runs/:id` per distinct `Assignment.workflowRunId` (same bounded pattern as M22.5A deliverables).
3. First artifact list page (`limit=50`) for verified deliverable events.

Omissions are labeled in UI footnotes. Mission/worker summaries cap at 15 rows and skip artifact pagination.

## Pagination and performance

- Feed display limit: `OFFICE_ACTIVITY_RECENT_LIMIT` (50).
- Workflow fetches scale with launched workflow-backed tasks, not workspace-wide WorkflowRun catalog.
- Task detail uses already-loaded Run/WorkflowRun queries plus scoped artifact loaders.

## Authorization

- READ-only Console surfaces; links target existing scoped routes.
- Domain builders throw on workspace mismatch (tested).
- VIEWER sees feed without execution mutations.

## Known limitations

- Agent-backed `FAILED` tasks may show **Time unavailable** without `WorkflowRun.completedAt`.
- Artifact events limited to loaded artifact page.
- Mission/worker views are bounded summaries, not full archives.

## M22.5C dependencies

- Observability rollups and automation hooks may consume the same projection package.
- Combined M22.5A–D acceptance (`verify:ci:clean`) remains M22.5D.
