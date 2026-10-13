import {
  OSVA_METRIC,
  type MetricKind,
  type OsvaMetricName,
} from "./metrics.js";

/**
 * OpenTelemetry instrument kinds as recorded by OSVA. Used to derive
 * Prometheus names after the collector prometheus exporter conversion.
 */
export const OSVA_METRIC_KIND = {
  [OSVA_METRIC.RUNS_STARTED]: "counter",
  [OSVA_METRIC.RUNS_COMPLETED]: "counter",
  [OSVA_METRIC.RUNS_FAILED]: "counter",
  [OSVA_METRIC.RUN_DURATION_MS]: "histogram",
  [OSVA_METRIC.RUN_ATTEMPT_DURATION_MS]: "histogram",
  [OSVA_METRIC.RUNTIME_EXECUTE_DURATION_MS]: "histogram",
  [OSVA_METRIC.MODEL_CALLS]: "counter",
  [OSVA_METRIC.MODEL_DURATION_MS]: "histogram",
  [OSVA_METRIC.MODEL_INPUT_TOKENS]: "histogram",
  [OSVA_METRIC.MODEL_OUTPUT_TOKENS]: "histogram",
  [OSVA_METRIC.TOOL_CALLS]: "counter",
  [OSVA_METRIC.TOOL_DURATION_MS]: "histogram",
  [OSVA_METRIC.TOOL_ERRORS]: "counter",
  [OSVA_METRIC.MEMORY_OPERATIONS]: "counter",
  [OSVA_METRIC.KNOWLEDGE_RETRIEVES]: "counter",
  [OSVA_METRIC.WORKFLOW_RECONCILIATIONS]: "counter",
  [OSVA_METRIC.EVALUATION_RECONCILIATIONS]: "counter",
  [OSVA_METRIC.HTTP_REQUESTS]: "counter",
  [OSVA_METRIC.HTTP_REQUEST_DURATION_MS]: "histogram",
  [OSVA_METRIC.QUEUE_JOBS]: "gauge",
  [OSVA_METRIC.QUEUE_STALLED]: "counter",
  [OSVA_METRIC.QUEUE_JOB_ERRORS]: "counter",
  [OSVA_METRIC.QUEUE_TIME_TO_START_MS]: "histogram",
  [OSVA_METRIC.RECOVERY_LEASE_INTERRUPTED]: "counter",
  [OSVA_METRIC.RECOVERY_TRANSPORT_REPAIRED]: "counter",
  [OSVA_METRIC.RECOVERY_ERRORS]: "counter",
  [OSVA_METRIC.RECOVERY_DURATION_MS]: "histogram",
  [OSVA_METRIC.SECURITY_EVENTS]: "counter",
} as const satisfies Record<OsvaMetricName, MetricKind>;

export function otelNameToPrometheusBase(otelName: string): string {
  return otelName.replaceAll(".", "_");
}

/**
 * Prometheus time-series name produced by the OpenTelemetry Collector
 * `prometheus` exporter for an OSVA instrument.
 *
 * Counters become monotonic sums and receive `_total`. Histograms keep the
 * base name; PromQL uses `_bucket`, `_sum`, and `_count` suffixes. Gauges
 * keep the base name with no suffix.
 */
export function prometheusMetricName(
  otelName: string,
  kind: MetricKind,
): string {
  const base = otelNameToPrometheusBase(otelName);
  return kind === "counter" ? `${base}_total` : base;
}

export function prometheusHistogramBucket(otelName: string): string {
  return `${otelNameToPrometheusBase(otelName)}_bucket`;
}

export function prometheusNameForOsvaMetric(name: OsvaMetricName): string {
  return prometheusMetricName(name, OSVA_METRIC_KIND[name]);
}
