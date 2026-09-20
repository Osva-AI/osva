/** Low-cardinality OSVA metric names. */
export const OSVA_METRIC = {
  RUNS_STARTED: "osva.runs.started",
  RUNS_COMPLETED: "osva.runs.completed",
  RUNS_FAILED: "osva.runs.failed",
  RUN_DURATION_MS: "osva.run.duration_ms",
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
} as const;

export type OsvaMetricName = (typeof OSVA_METRIC)[keyof typeof OSVA_METRIC];

export type MetricAttributes = Readonly<
  Record<string, string | number | boolean>
>;

export type MetricKind = "counter" | "histogram";

export interface MetricRecord {
  readonly name: OsvaMetricName | string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly attributes?: MetricAttributes;
}
