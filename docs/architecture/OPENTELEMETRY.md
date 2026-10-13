# OpenTelemetry Foundation (Stage 2.9A)

## Boundary

```text
Run / RunAttempt / RunStep / WorkflowNodeRun / EvaluationRun
  → durable OSVA product state (PostgreSQL authority)

OpenTelemetry spans / metrics
  → disposable exportable telemetry (never lifecycle authority)
```

`RunStepRecorder` is unchanged as the durable execution observability seam.
OpenTelemetry augments major boundaries without replacing RunStep persistence.

## Packages

| Package | Role |
|---------|------|
| `@osva/observability` | Vendor-neutral `OsvaInstrumentation`, span names, low-cardinality metrics |
| `@osva/adapters-opentelemetry` | Node SDK setup, OTLP export, context propagation, shutdown |

Domain and orchestration depend only on `@osva/observability`. OpenTelemetry SDK
types stay inside the adapter.

## Configuration

Standard environment variables:

```text
OTEL_SERVICE_NAME
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_HEADERS
OTEL_SDK_DISABLED
OTEL_TRACES_SAMPLER
OTEL_TRACES_SAMPLER_ARG
```

When no OTLP endpoint is configured, all processes use a no-op instrumentation
implementation.

Default service names when `OTEL_SERVICE_NAME` is unset:

```text
osva-web
osva-worker
osva-scheduler
osva-workflow-orchestrator
osva-mcp
osva-knowledge-worker
```

Supported sampler names: `always_on`, `always_off`, `traceidratio`,
`parentbased_always_on`, `parentbased_always_off`, `parentbased_traceidratio`.
Unknown sampler names fall back to the SDK default and do not fail startup.

## Trace propagation

BullMQ jobs may include transport-only `__osvaTraceCarrier` metadata with W3C
`traceparent`. Workers extract context, then create `osva.queue.process` as a
child of that context. Queue redelivery may create another processing span while
preserving the canonical `RunAttemptId`.

`osva.run_attempt.duration_ms` is the attempt-outcome duration. `osva.run.duration_ms`
is a compatibility alias of that same value. Runtime-only duration is
`osva.runtime.execute.duration_ms`.

## Privacy defaults

Telemetry is metadata-only by default. Spans and metrics must not include
prompts, model outputs, tool arguments/results, memory values, MCP payloads, or
secret material.

No configured OTLP endpoint remains a supported no-op mode. Export failures must
not block execution. An optional Collector, Prometheus scrape, Grafana
dashboards, and example alerts live under `deploy/observability/` and the
Compose overlay `deploy/compose/compose.observability.yml`. They are not
required to start the Community execution engine.

## Export path

```text
OSVA processes
  → OTLP HTTP (`OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/traces` and `/v1/metrics`)
  → OpenTelemetry Collector (optional)
  → Prometheus-compatible scrape (`:8889` internal)
  → Optional Prometheus / Grafana
```

The Node exporter is `@opentelemetry/exporter-*-otlp-http`. Give the **base**
endpoint (example `http://otel-collector:4318`) without a signal path. The
adapter appends `/v1/traces` and `/v1/metrics`. Metrics export every 5 seconds.
Shutdown flushes exporters and must not fail process exit.

`OTEL_EXPORTER_OTLP_HEADERS` is parsed (`key=value` comma-separated) and sent
on export requests. Treat the value as a secret. Inject it from a Compose
secret, Kubernetes Secret, or `secretEnv` — never a ConfigMap — and do not log
header values.

## Compose

Default `deploy/compose/compose.yml` does not set an OTLP endpoint. Enable
observability with the overlay (not a Compose profile — profiles cannot
condition application env):

```bash
docker compose -f compose.yml -f compose.observability.yml up -d
```

OTLP receivers and the Prometheus scrape port stay on the internal network.
Grafana binds `127.0.0.1` only.

## Helm

`telemetry.enabled` defaults to `false`. When true, the chart injects
`OTEL_EXPORTER_OTLP_ENDPOINT` and sampler settings into the shared ConfigMap
and a distinct `OTEL_SERVICE_NAME` on web, worker, scheduler,
workflow-orchestrator, knowledge-worker, and MCP. The chart does not deploy a
Collector. See `deploy/observability/helm/external-collector-values.example.yaml`.

## Prometheus names

Dotted OTEL instrument names become underscores. Counters gain `_total`.
See `deploy/observability/METRICS.md`.

## Retention and cost

Example Prometheus retention is `OSVA_METRICS_RETENTION` (default 15d). Traces
are debug-exported unless you swap in
`otel-collector-traces-backend.yaml`. Sampling (`OTEL_TRACES_SAMPLER`) reduces
trace volume; metrics remain periodic. Export is fail-open and must not be
used as a readiness dependency.
