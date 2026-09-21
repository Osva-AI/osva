/** OSVA span names for exportable OpenTelemetry traces. */
export const OSVA_SPAN = {
  RUN_CREATE: "osva.run.create",
  RUN_ATTEMPT_EXECUTE: "osva.run_attempt.execute",
  RUNTIME_EXECUTE: "osva.runtime.execute",
  MODEL_GENERATE_TEXT: "osva.model.generate_text",
  TOOL_INVOKE: "osva.tool.invoke",
  KNOWLEDGE_RETRIEVE: "osva.knowledge.retrieve",
  MEMORY_OPERATION: "osva.memory.operation",
  WORKFLOW_RECONCILE: "osva.workflow.reconcile",
  WORKFLOW_NODE_EXECUTE: "osva.workflow.node.execute",
  EVALUATION_RECONCILE: "osva.evaluation.reconcile",
  SCHEDULE_MATERIALIZE: "osva.schedule.materialize",
  SCHEDULE_DISPATCH: "osva.schedule.dispatch",
  ASSIGNMENT_LAUNCH: "osva.assignment.launch",
  MCP_DISCOVER: "osva.mcp.discover",
  MCP_CALL_TOOL: "osva.mcp.call_tool",
  MCP_INBOUND_REQUEST: "osva.mcp.inbound.request",
  MCP_INBOUND_TOOL: "osva.mcp.inbound.tool",
  MCP_INBOUND_RESOURCE: "osva.mcp.inbound.resource",
  QUEUE_PROCESS: "osva.queue.process",
} as const;

export type OsvaSpanName = (typeof OSVA_SPAN)[keyof typeof OSVA_SPAN];
