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
```

When no OTLP endpoint is configured, all processes use a no-op instrumentation
implementation.

## Trace propagation

BullMQ jobs may include transport-only `__osvaTraceCarrier` metadata with W3C
`traceparent`. Workers extract context and continue the trace. Queue redelivery
may create another processing span while preserving the canonical `RunAttemptId`.

## Privacy defaults

Telemetry is metadata-only by default. Spans and metrics must not include
prompts, model outputs, tool arguments/results, memory values, MCP payloads, or
secret material.
