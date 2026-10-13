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
  REQUEST_ID: "osva.request.id",
  MODEL_PROFILE_VERSION_ID: "osva.model_profile_version.id",
  KNOWLEDGE_BINDING_NAME: "osva.knowledge.binding_name",
  KNOWLEDGE_INDEX_COUNT: "osva.knowledge.index_count",
  KNOWLEDGE_TOP_K: "osva.knowledge.top_k",
  KNOWLEDGE_RESULT_COUNT: "osva.knowledge.result_count",
  HTTP_METHOD: "osva.http.method",
  HTTP_ROUTE_FAMILY: "osva.http.route_family",
  HTTP_STATUS_CLASS: "osva.http.status_class",
} as const;

/** Metric attribute keys allowed on low-cardinality counters/histograms. */
export const OSVA_METRIC_ATTR = {
  PROVIDER: "provider",
  RUNTIME_KIND: "runtime_kind",
  TOOL_EXECUTION_KIND: "tool_execution_kind",
  OPERATION: "operation",
  TERMINAL_STATUS: "terminal_status",
  ERROR_CATEGORY: "error_category",
  METHOD: "method",
  ROUTE_FAMILY: "route_family",
  STATUS_CLASS: "status_class",
  QUEUE: "queue",
  STATE: "state",
  KIND: "kind",
  EVENT: "event",
  OUTCOME: "outcome",
} as const;

/** Product IDs and identities that must never appear on metric labels. */
export const FORBIDDEN_METRIC_LABELS = new Set([
  "runId",
  "run_id",
  "run.id",
  "runAttemptId",
  "run_attempt_id",
  "run.attempt.id",
  "workflowRunId",
  "workflow_run_id",
  "workflow.run.id",
  "workflowNodeRunId",
  "workflow_node_run_id",
  "workflow.node.run.id",
  "workspaceId",
  "workspace_id",
  "workspace.id",
  "subjectId",
  "subject_id",
  "subject.id",
  "userId",
  "user_id",
  "user.id",
  "requestId",
  "request_id",
  "request.id",
  "traceId",
  "trace_id",
  "trace.id",
  "executionOwner",
  "execution_owner",
  "execution.owner",
  "agentId",
  "agent_id",
  "agent.id",
  "agentVersionId",
  "agent_version_id",
  "workflowVersionId",
  "workflow_version_id",
  "toolVersionId",
  "tool_version_id",
  "connectorVersionId",
  "connector_version_id",
  "evaluationRunId",
  "evaluation_run_id",
  "osva.run.id",
  "osva.run_attempt.id",
  "osva.agent.id",
  "osva.agent_version.id",
  "osva.workflow_version.id",
  "osva.workflow_run.id",
  "osva.workflow_node_run.id",
  "osva.tool_version.id",
  "osva.connector_version.id",
  "osva.evaluation_run.id",
  "osva.request.id",
  "osva.workspace.id",
  "osva.subject.id",
  "osva.user.id",
  "osva.trace.id",
  "osva.execution.owner",
]);

const FORBIDDEN_METRIC_LABEL_NORMALIZED = new Set(
  [...FORBIDDEN_METRIC_LABELS].map(normalizeMetricLabelKey),
);

export function normalizeMetricLabelKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isForbiddenMetricLabel(key: string): boolean {
  if (FORBIDDEN_METRIC_LABELS.has(key)) {
    return true;
  }

  return FORBIDDEN_METRIC_LABEL_NORMALIZED.has(normalizeMetricLabelKey(key));
}
