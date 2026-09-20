/** Trace attribute keys for OSVA product correlation. */
export const OSVA_ATTR = {
  RUN_ID: "osva.run.id",
  RUN_ATTEMPT_ID: "osva.run_attempt.id",
  AGENT_VERSION_ID: "osva.agent_version.id",
  WORKFLOW_VERSION_ID: "osva.workflow_version.id",
  WORKFLOW_RUN_ID: "osva.workflow_run.id",
  WORKFLOW_NODE_RUN_ID: "osva.workflow_node_run.id",
  TOOL_VERSION_ID: "osva.tool_version.id",
  CONNECTOR_VERSION_ID: "osva.connector_version.id",
  EVALUATION_RUN_ID: "osva.evaluation_run.id",
  RUNTIME_KIND: "osva.runtime.kind",
  OPERATION: "osva.operation",
  PROVIDER: "osva.provider",
  TOOL_EXECUTION_KIND: "osva.tool.execution_kind",
  TERMINAL_STATUS: "osva.terminal_status",
  ERROR_CATEGORY: "osva.error_category",
  MODEL_PROFILE_VERSION_ID: "osva.model_profile_version.id",
  KNOWLEDGE_BINDING_NAME: "osva.knowledge.binding_name",
  KNOWLEDGE_INDEX_COUNT: "osva.knowledge.index_count",
  KNOWLEDGE_TOP_K: "osva.knowledge.top_k",
  KNOWLEDGE_RESULT_COUNT: "osva.knowledge.result_count",
} as const;

/** Metric attribute keys allowed on low-cardinality counters/histograms. */
export const OSVA_METRIC_ATTR = {
  PROVIDER: "provider",
  RUNTIME_KIND: "runtime_kind",
  TOOL_EXECUTION_KIND: "tool_execution_kind",
  OPERATION: "operation",
  TERMINAL_STATUS: "terminal_status",
  ERROR_CATEGORY: "error_category",
} as const;

/** Product IDs that must never appear on metric labels. */
export const FORBIDDEN_METRIC_LABELS = new Set([
  "runId",
  "runAttemptId",
  "workspaceId",
  "agentId",
  "agentVersionId",
  "workflowVersionId",
  "toolVersionId",
  "connectorVersionId",
  "evaluationRunId",
  "osva.run.id",
  "osva.run_attempt.id",
  "osva.agent_version.id",
  "osva.workflow_version.id",
  "osva.tool_version.id",
  "osva.connector_version.id",
  "osva.evaluation_run.id",
]);
