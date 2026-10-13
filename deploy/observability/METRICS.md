# OSVA Prometheus metric names

OpenTelemetry instrument names use dots. The Collector `prometheus` exporter
rewrites them before PromQL. **Do not query dotted names.**

| OTEL instrument | Kind | Prometheus name | Notes |
|-----------------|------|-----------------|-------|
| `osva.http.requests` | counter | `osva_http_requests_total` | Labels: `method`, `route_family`, `status_class` |
| `osva.http.request.duration_ms` | histogram | `osva_http_request_duration_ms_bucket` / `_sum` / `_count` | Same labels |
| `osva.queue.jobs` | gauge | `osva_queue_jobs` | Labels: `queue` (`execution`\|`other`), `state` (`waiting`\|`active`\|`delayed`\|`failed`) |
| `osva.queue.stalled` | counter | `osva_queue_stalled_total` | |
| `osva.queue.job_errors` | counter | `osva_queue_job_errors_total` | |
| `osva.queue.time_to_start_ms` | histogram | `osva_queue_time_to_start_ms_bucket` | |
| `osva.recovery.lease_interrupted` | counter | `osva_recovery_lease_interrupted_total` | CAS-won interruptions only |
| `osva.recovery.transport_repaired` | counter | `osva_recovery_transport_repaired_total` | Newly accepted enqueue only |
| `osva.recovery.errors` | counter | `osva_recovery_errors_total` | |
| `osva.recovery.duration_ms` | histogram | `osva_recovery_duration_ms_bucket` | |
| `osva.security.events` | counter | `osva_security_events_total` | Label `event` is a bounded name |
| `osva.runs.started` | counter | `osva_runs_started_total` | |
| `osva.runs.completed` | counter | `osva_runs_completed_total` | |
| `osva.runs.failed` | counter | `osva_runs_failed_total` | |
| `osva.run_attempt.duration_ms` | histogram | `osva_run_attempt_duration_ms_bucket` | Label `terminal_status` |
| `osva.run.duration_ms` | histogram | `osva_run_duration_ms_bucket` | Compatibility alias of attempt duration |
| `osva.runtime.execute.duration_ms` | histogram | `osva_runtime_execute_duration_ms_bucket` | Label `runtime_kind` |
| `osva.model.calls` | counter | `osva_model_calls_total` | |
| `osva.model.duration_ms` | histogram | `osva_model_duration_ms_bucket` | |
| `osva.model.input_tokens` | histogram | `osva_model_input_tokens_bucket` | |
| `osva.model.output_tokens` | histogram | `osva_model_output_tokens_bucket` | |
| `osva.tool.calls` | counter | `osva_tool_calls_total` | |
| `osva.tool.duration_ms` | histogram | `osva_tool_duration_ms_bucket` | |
| `osva.tool.errors` | counter | `osva_tool_errors_total` | |
| `osva.memory.operations` | counter | `osva_memory_operations_total` | |
| `osva.knowledge.retrieves` | counter | `osva_knowledge_retrieves_total` | |
| `osva.workflow.reconciliations` | counter | `osva_workflow_reconciliations_total` | No terminal-outcome series |
| `osva.evaluation.reconciliations` | counter | `osva_evaluation_reconciliations_total` | |

`service_name` may appear when `resource_to_telemetry_conversion` is enabled.

## Forbidden metric labels

Never present: `runId`, `runAttemptId`, `workspaceId`, API-key identity,
`requestId`, `traceId`, or other product IDs.

## Gaps

- Process `/ready` is not exported as a Prometheus metric (probes are excluded
  from HTTP telemetry). Use Kubernetes/Compose healthchecks for dependency
  unavailability.
- Workflow terminal outcomes are durable PostgreSQL state, not a Prom series.
- Collector availability is only measurable if you scrape the Collector.
