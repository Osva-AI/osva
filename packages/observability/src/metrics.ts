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
