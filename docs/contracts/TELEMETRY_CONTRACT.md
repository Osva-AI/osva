# Telemetry Contract

## Canonical entities

OSVA owns:

- Run
- RunAttempt
- RunStep
- UsageRecord
- EvaluationResult

`RunLog` is not a persisted domain entity. Operational logs are process stdout
JSON events and are not lifecycle authority. Treat any remaining `RunLog`
diagram labels as conceptual only.

## TelemetrySink

External exporters receive normalized events/spans.

## Correlation fields

Where applicable:

```text
workspaceId
agentId
agentVersionId
workflowRunId
runId
runAttemptId
runStepId
```

## Duration metrics

- `osva.run_attempt.duration_ms` — time from `ExecuteRunAttempt` start to a terminal succeeded/failed outcome. Labels: `terminal_status`.
- `osva.run.duration_ms` — compatibility alias of the attempt duration (same value and labels). Do not interpret it as runtime-only time.
- `osva.runtime.execute.duration_ms` — `RuntimeAdapter.execute` duration. Labels: `runtime_kind`.

## Rules

- telemetry exporters do not become canonical storage;
- secret values are redacted;
- dropping external telemetry must not destroy Run state;
- product IDs and request/trace identities must never appear on metric labels.

## Prometheus export

The optional Collector `prometheus` exporter converts dotted OTEL names:

- counters → `osva_<name>_total`
- histograms → `osva_<name>_bucket` / `_sum` / `_count`
- gauges → `osva_<name>`

See `deploy/observability/METRICS.md`. Dashboards and alerts must use these
names. Example Grafana JSON and Prometheus rules are not a hosted product.

## Deployment

- Default: no OTLP endpoint → no-op instrumentation.
- Compose overlay: `deploy/compose/compose.observability.yml`.
- Helm: `telemetry.enabled` (default false) plus an external Collector.
- `OTEL_EXPORTER_OTLP_HEADERS` is secret-safe injection only; never log values.
- Community observability is not license-gated.

## Recovery metrics

- `osva.recovery.transport_repaired` increments only when `JobQueue.enqueue`
  reports `outcome: "enqueued"`. An idempotent `already_present` result is not a
  confirmed new delivery and must not be counted as a repair.
- `osva.recovery.lease_interrupted` increments only after a CAS-won lease
  interruption.

## Security events

Control-plane and Console request-guard rejections emit bounded
`osva.security.events` counters. Console events do not include raw Host/Origin
strings or `OSVA_CONSOLE_API_KEY`.
