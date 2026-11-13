# M22.5A — Unified Office Deliverables

## Build versus reuse

| Requirement | Existing capability | M22.5A approach |
| --- | --- | --- |
| Artifact records | `GET /v1/artifacts`, `ArtifactRepository.list` | Reuse; workspace library paginates via existing cursor |
| Run-scoped artifacts | `?runId=` / `?runAttemptId=` | Reuse for agent-backed task and mission aggregation |
| Workflow child artifacts | `workflow-artifacts.ts` + `loadWorkflowRunArtifacts` | Reuse for workflow-backed tasks and mission scope |
| Task execution linkage | `Assignment.runId` / `workflowRunId` | Reuse; no new persistence |
| Mission linkage | `Assignment.goalId` | Reuse after verified task association |
| Preview / download | `RunArtifactsSection`, `ArtifactPreviewPanel`, BFF content routes | Reuse |
| Inbox deliverable rows | `buildDeliverableInboxItem` | Unchanged; library is separate read surface |

**Data-access design gate:** Not triggered. Existing workspace artifact list plus assignment list and selective workflow-run fetches (only runs referenced by Office assignments) satisfy bounded provenance without a second artifact authority or new HTTP contract.

## Provenance rules

Read-only association in `packages/domain/src/office-deliverable-provenance.ts` (Console adapter: `apps/console/src/client/lib/office-deliverable-provenance.ts`).

### Agent-backed Office Task

`Assignment.runId` must equal `Artifact.producer.runId`. Multiple assignments on the same run → **ambiguous** (no arbitrary pick).

### Workflow-backed Office Task

Child runs are collected from AGENT workflow nodes (same rules as `collectAgentChildRuns`). `Artifact.producer.runId` must match a child run on the assignment's `workflowRunId`. Multiple assignments on the same workflow run → **ambiguous**.

### Mission attribution

Only when task association is **verified** and `Assignment.goalId` is set.

### Unassociated workspace artifacts

Visible in `/office/deliverables`; UI copy marks **No verified Office task**. No mission is inferred.

## Console surfaces

| Route / section | Behavior |
| --- | --- |
| `/office/deliverables` | Paginated workspace artifacts + provenance columns; client filters scoped to current page |
| Mission Detail → Deliverables | Per linked launched task; agent list + workflow loader per task only |
| Task Detail | Existing `TaskDeliverablesSection` unchanged |

## Authorization and security

No backend changes. Artifact READ remains control-plane scoped (workspace isolation, blob authorization, safe preview/download). Team membership does not expand artifact permissions.

## Pagination and partial failures

- Library: `DEFAULT_ARTIFACT_LIST_LIMIT` page size; UI exposes next/previous cursor and truncated banner.
- Workflow index for library: loads only workflow runs tied to assignments (not entire workspace workflow catalog).
- Mission section: surfaces per-task loader failures; distinguishes empty from error.

## Performance limitations

- Library filters do not search beyond the loaded artifact page.
- Mission view issues O(linked launched tasks) artifact/workflow calls — bounded by mission task count, not workspace workflow fan-out.

## Deferred (M22.5C–D)

Observability rollups, automation, acceptance harness extensions, and combined milestone PR/CI closeout. Office Activity (M22.5B) is documented in `M22_5B_OFFICE_ACTIVITY.md`.
