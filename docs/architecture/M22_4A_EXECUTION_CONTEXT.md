# M22.4A — Office execution context foundation

## Build versus reuse

| Need | Reuse | Notes |
| --- | --- | --- |
| Assignment lifecycle & reconcile | `GET /v1/office/assignments/:id`, `useOfficeAssignmentQuery` | M22.3D; no new Office APIs |
| Agent Run status | `GET /v1/runs/:id`, `useRunQuery` | Canonical Run detail remains `/runs/:runId` |
| WorkflowRun + node rows | `GET /v1/workflow-runs/:id` (embeds `nodeRuns`, `approvalRequests`) | Same payload as WorkflowRun detail |
| Node ordering / statuses | `compareWorkflowNodeRuns` pattern | New domain `sortOfficeExecutionNodeRuns` mirrors console overlay |
| Workflow node labels | `resolveWorkflowCanvasLabel`, `useWorkflowVersionQuery` | No duplicate graph UI |
| Worker directory | `GET /v1/office/workers`, `useOfficeWorkersQuery` | Attribution index only |
| AgentVersion → AgentId | `useAgentVersionCatalogQuery` (existing) | **Deferred:** version-without-agentId lookup API would avoid catalog fan-out |
| Worker history | `GET /v1/office/assignments` list + client filter | No per-worker endpoint; bounded to 25 rows |

**Not built:** second execution engine, worker runtime, synthetic handoffs, telemetry, performance analytics, approval UI changes.

## Data flow

```text
Task Detail
  → useOfficeAssignmentQuery (reconcile)
  → useOfficeWorkerQuery
  → useRunQuery | useWorkflowRunQuery (read-only)
  → useWorkflowVersionQuery (workflow definition labels/types)
  → useOfficeWorkersQuery + optional useAgentVersionCatalogQuery
  → @osva/domain office-execution-context-projection
  → TaskExecutionContextSection (timeline + links)

Worker Detail
  → useOfficeAssignmentsQuery + useOfficeGoalsQuery (workspace-scoped lists)
  → buildOfficeWorkerAssignmentHistory (domain)
  → WorkerAssignmentActivitySection
```

Rendering and fetching **never** call `launch`, workflow ingestion, or run mutation endpoints.

## Worker attribution rules

1. Only **AGENT** workflow nodes carry `agentVersionId` in the pinned WorkflowVersion definition.
2. Resolve `AgentVersionId → AgentId` using the in-memory catalog built from existing agent version list APIs (same workspace).
3. Map `AgentId → OfficeWorker[]` from `listOfficeWorkers` in that workspace.
4. **Exactly one** worker for the Agent → `RESOLVED` attribution with worker name/link.
5. **Zero** workers → `UNAVAILABLE` / `NO_REGISTERED_WORKER` (show Agent when known).
6. **Multiple** workers sharing the Agent → `UNAVAILABLE` / `AMBIGUOUS_WORKERS` (show Agent link; do not pick assignment worker or team membership).

**Future contract (deferred):** explicit `officeWorkerId` on workflow AGENT nodes or Run provenance would remove catalog dependency and ambiguity without inferring ownership.

Assignment-level worker (`Assignment.officeWorkerId`) is always shown in task metadata; node-level attribution is independent.

## Worker execution history semantics

- Section title: **Office Assignment activity**.
- Source: workspace assignment list filtered by `officeWorkerId`, sorted by `createdAt` desc, max 25.
- Includes mission link when `goalId` is set (goal title from list cache).
- Execution link when `runId` or `workflowRunId` present.
- Does **not** imply all Runs for the linked Agent across the platform.

## Authorization

Unchanged M22.3 matrix: READ suffices for execution summaries; links target existing Run/WorkflowRun/Assignment routes that re-validate workspace scope. Projection throws on workspace mismatch between assignment and linked execution records (tested). No prompts, model output, or tool payloads in timeline rows.

## Data freshness

- Task detail: existing assignment reconcile poll while `RUNNING`; WorkflowRun query uses `workflowRunRefetchInterval` when live.
- Worker history: assignment list `staleTime` 60s; manual navigation refresh; no new polling loops.

## Performance

| Surface | Calls (typical) |
| --- | --- |
| Task (agent) | assignment + worker + run (+ existing attempts if deliverables) |
| Task (workflow) | + workflow run + workflow version; optional catalog (1 + N agents versions, existing catalog helper) |
| Worker history | assignments list + goals list (reused caches) |

## M22.4B/C dependencies

- **M22.4B:** Team Chat handoff messages may reference `WorkflowNodeRunId`; this slice only links to canonical execution pages.
- **M22.4C:** Human approval UX enhancements remain on WorkflowRun detail; timeline shows approval id/status link only.

## Deferred scope

Synthetic handoffs, worker-authored chat, autonomous delegation, HumanTask entity, aggregate worker analytics, explicit worker-on-node schema, catalog-free version resolution API.
