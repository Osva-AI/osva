/** Low-cardinality OSVA metric names. */
export const OSVA_METRIC = {
  RUNS_STARTED: "osva.runs.started",
  RUNS_COMPLETED: "osva.runs.completed",
  RUNS_FAILED: "osva.runs.failed",
  /**
   * Compatibility alias for attempt duration. Same value and labels as
   * `osva.run_attempt.duration_ms`. Runtime-only duration uses
   * `osva.runtime.execute.duration_ms`.
   */
  RUN_DURATION_MS: "osva.run.duration_ms",
  RUN_ATTEMPT_DURATION_MS: "osva.run_attempt.duration_ms",
  RUNTIME_EXECUTE_DURATION_MS: "osva.runtime.execute.duration_ms",
  MODEL_CALLS: "osva.model.calls",
  MODEL_DURATION_MS: "osva.model.duration_ms",
  MODEL_INPUT_TOKENS: "osva.model.input_tokens",
  MODEL_OUTPUT_TOKENS: "osva.model.output_tokens",
  TOOL_CALLS: "osva.tool.calls",
  TOOL_DURATION_MS: "osva.tool.duration_ms",
  TOOL_ERRORS: "osva.tool.errors",
  MEMORY_OPERATIONS: "osva.memory.operations",
  KNOWLEDGE_RETRIEVES: "osva.knowledge.retrieves",
  WORKFLOW_RECONCILIATIONS: "osva.workflow.reconciliations",
  EVALUATION_RECONCILIATIONS: "osva.evaluation.reconciliations",
  HTTP_REQUESTS: "osva.http.requests",
  HTTP_REQUEST_DURATION_MS: "osva.http.request.duration_ms",
  QUEUE_JOBS: "osva.queue.jobs",
  QUEUE_STALLED: "osva.queue.stalled",
  QUEUE_JOB_ERRORS: "osva.queue.job_errors",
  QUEUE_TIME_TO_START_MS: "osva.queue.time_to_start_ms",
  RECOVERY_LEASE_INTERRUPTED: "osva.recovery.lease_interrupted",
  RECOVERY_TRANSPORT_REPAIRED: "osva.recovery.transport_repaired",
  RECOVERY_ERRORS: "osva.recovery.errors",
  RECOVERY_DURATION_MS: "osva.recovery.duration_ms",
  SECURITY_EVENTS: "osva.security.events",
  INFERENCE_RESPONSE_CACHE_EVENTS: "osva.inference_response_cache.events",
  BATCH_SUBMISSION_ATTEMPTS: "osva.batch.submission_attempts",
  BATCH_SUBMISSION_SUCCESS: "osva.batch.submission_success",
  BATCH_SUBMISSION_FAILURE: "osva.batch.submission_failure",
  BATCH_RECONCILIATION_ATTEMPTS: "osva.batch.reconciliation_attempts",
  BATCH_RECONCILIATION_FAILURES: "osva.batch.reconciliation_failures",
  BATCH_JOB_TERMINAL: "osva.batch.job_terminal",
  BATCH_ITEM_TERMINAL: "osva.batch.item_terminal",
  BATCH_CORRELATION_ANOMALIES: "osva.batch.correlation_anomalies",
  BATCH_RECONCILIATION_REQUIRED: "osva.batch.reconciliation_required",
  BATCH_CANCELLATIONS: "osva.batch.cancellations",
  BATCH_DURATION_MS: "osva.batch.duration_ms",
} as const;

/** Bounded cardinality labels for {@link OSVA_METRIC.INFERENCE_RESPONSE_CACHE_EVENTS}. */
export const INFERENCE_RESPONSE_CACHE_METRIC = {
  EVENTS: OSVA_METRIC.INFERENCE_RESPONSE_CACHE_EVENTS,
} as const;

export type OsvaMetricName = (typeof OSVA_METRIC)[keyof typeof OSVA_METRIC];

export type MetricAttributes = Readonly<
  Record<string, string | number | boolean>
>;

export type MetricKind = "counter" | "histogram" | "gauge";

export interface MetricRecord {
  readonly name: OsvaMetricName | string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly attributes?: MetricAttributes;
}
