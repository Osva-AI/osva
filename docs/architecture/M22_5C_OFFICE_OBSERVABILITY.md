# M22.5C — Virtual Office Observability and Mission Control

## Build versus reuse

| Requirement | Existing capability | M22.5C approach |
| --- | --- | --- |
| Task status counts | `GET /v1/office/assignments`, M22.1 `summarizeAssignmentCounts` | Extend counts; domain `summarizeTaskExecution` |
| Terminal success rate | — | New pure projection; cancelled in denominator |
| Duration | Assignment timestamps (M22.5B rules) | `measureAssignmentDurationMs`; no `updatedAt` |
| Worker attribution | `Assignment.officeWorkerId` | `summarizeWorkerPerformance`; no Agent-run fan-out |
| Workflow child runs | M22.5A `collectWorkflowChildRunBindings` | Usage attribution helper only (no dashboard N+1) |
| Team rollups | Team memberships API | Current members → distinct assigned tasks |
| Mission metrics | `computeMissionProgress` (M22.3) | `summarizeMissionPerformance`; Goal status unchanged |
| Activity / deliverables | M22.5B / M22.5A | Bounded sections on Mission Control (shared feed query) |
| Run usage / cost | `GetRunAttemptUsage`, `aggregateRunAttemptUsageBatch` (server) | Merge helpers in domain; **Console defers workspace rollup** |
| OpenTelemetry | `packages/observability` | Operational only; Mission Control does not require OTLP/Grafana |

## Metrics definitions

### Task execution

| Metric | Definition |
| --- | --- |
| Total | Count of assignments in scope |
| Pending / Running / Completed / Failed / Cancelled | `Assignment.status` |
| Active | Pending + Running |
| Terminal success rate | `COMPLETED / (COMPLETED + FAILED + CANCELLED)` |
| Duration | `startedAt` → terminal timestamp (`completedAt` or `cancelledAt`); omitted when missing |

Cancelled tasks are **excluded from the numerator** and **included in the denominator**. Pending and running tasks are excluded from terminal success rate.

### Worker performance

Scope: assignments where `officeWorkerId` matches. Does not attribute all Runs for the linked Agent.

### Team performance

Scope: **current** `TeamMembership` worker ids → **distinct** assignments owned by those workers. Overlapping team membership may count the same task on multiple team pages. Team totals must **not** be summed into a workspace total.

### Mission performance

Scope: `Assignment.goalId`. Completion ratio = completed / linked total (presentation only). Goal status remains manual.

## Usage and cost accounting

Domain `mergeOfficeUsageSummaries` reuses evaluation-run merge semantics:

- Integer micro-USD until display formatting
- `estimatedCostUsdMicros` null when no priced portions
- `costCoverage`: `unmeasured` \| `partial` \| `priced_partial` \| `complete`
- Unpriced model calls disclosed; partial estimates are not labeled complete

`collectDistinctRunIdsForOfficeTasks` deduplicates workflow child runs. RunAttempt collection follows `collectRunAttemptIdsForUsageAccounting` (retries = new attempts; redelivery reuses id).

## Data-access design gate (operator outcome)

**No new backend read endpoint in M22.5C.**

### Current API limits

- Usage: one HTTP GET per RunAttempt (`/v1/runs/:runId/attempts/:runAttemptId/usage`)
- Batch aggregation exists on `RunRepository.aggregateRunAttemptUsageBatch` but is **not** exposed as a workspace-scoped Office rollup API
- Assignment list is the workspace task universe (no Office-specific pagination contract in Console)

### Representative query fan-out (Console)

| Workload | Approximate HTTP reads (Mission Control load) |
| --- | --- |
| 25 tasks, 0 workflow | assignments + workers + teams + memberships + artifacts page + **0** workflow GETs |
| 25 tasks, 5 workflow-launched | **+5** workflow-run GETs (+ version GETs per existing activity loader) |
| 100 tasks, 20 workflow-launched | Same pattern; **O(launched workflow tasks)** not O(100) |

Workspace **token/cost rollup** for all tasks would be **O(runs × attempts)** via today's public API — rejected for Mission Control. UI shows task metrics from assignments and links to run-level usage.

### Deferred (requires architecture approval)

Minimal read-only contract candidate for M22.5D+:

- Workspace-scoped, bounded Office usage summary
- Inputs: optional worker/team/mission filters, time window
- Backend: `aggregateRunAttemptUsageBatch` over attributed RunAttempt ids with deduped child runs
- Security: same READ + workspace isolation as runs

## OpenTelemetry boundary

Mission Control reads canonical PostgreSQL-backed REST resources only. OTel metrics/traces remain diagnostic; Community Edition works without Prometheus/Grafana.

## Security

- READ-only dashboards; no mutations
- Workspace isolation enforced in aggregators (`assertWorkspace`)
- Worker/team metrics do not expand permissions
- No model output, tool payloads, or secrets in metrics UI

## Known limitations

- Assignment list scope (not full archive if API paginates in future)
- No workspace estimated cost on Mission Control / Worker / Team / Mission summaries
- Workflow-backed usage attribution in domain requires child run index (workflow GET)
- M22.5A deliverables count on mission metrics optional / section-specific

## M22.5D dependencies

- `verify:ci:clean` combined acceptance
- Optional approved Office usage rollup endpoint + HTTP security tests
- Query-count regression harness for Mission Control at 100+ tasks
