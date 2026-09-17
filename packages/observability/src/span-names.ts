/** OSVA span names for exportable OpenTelemetry traces. */
export const OSVA_SPAN = {
  RUN_CREATE: "osva.run.create",
  RUN_ATTEMPT_EXECUTE: "osva.run_attempt.execute",
  RUNTIME_EXECUTE: "osva.runtime.execute",
  MODEL_GENERATE_TEXT: "osva.model.generate_text",
  TOOL_INVOKE: "osva.tool.invoke",
  MEMORY_OPERATION: "osva.memory.operation",
  WORKFLOW_RECONCILE: "osva.workflow.reconcile",
  WORKFLOW_NODE_EXECUTE: "osva.workflow.node.execute",
  EVALUATION_RECONCILE: "osva.evaluation.reconcile",
  SCHEDULE_MATERIALIZE: "osva.schedule.materialize",
  SCHEDULE_DISPATCH: "osva.schedule.dispatch",
  ASSIGNMENT_LAUNCH: "osva.assignment.launch",
  MCP_DISCOVER: "osva.mcp.discover",
  MCP_CALL_TOOL: "osva.mcp.call_tool",
  QUEUE_PROCESS: "osva.queue.process",
} as const;

export type OsvaSpanName = (typeof OSVA_SPAN)[keyof typeof OSVA_SPAN];
