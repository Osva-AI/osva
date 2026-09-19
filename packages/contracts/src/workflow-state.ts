export const WORKFLOW_RUN_STATES = [
  "PENDING",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export type WorkflowRunState = (typeof WORKFLOW_RUN_STATES)[number];

export const TERMINAL_WORKFLOW_RUN_STATES = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export type TerminalWorkflowRunState =
  (typeof TERMINAL_WORKFLOW_RUN_STATES)[number];

export const WORKFLOW_NODE_RUN_STATES = [
  "PENDING",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;

export type WorkflowNodeRunState = (typeof WORKFLOW_NODE_RUN_STATES)[number];

export const TERMINAL_WORKFLOW_NODE_RUN_STATES = [
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;

export type TerminalWorkflowNodeRunState =
  (typeof TERMINAL_WORKFLOW_NODE_RUN_STATES)[number];

export const WORKFLOW_EVENT_TIMEOUT_ERROR_CODE = "WORKFLOW_EVENT_TIMEOUT";
