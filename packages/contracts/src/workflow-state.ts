export const WORKFLOW_RUN_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export type WorkflowRunState = (typeof WORKFLOW_RUN_STATES)[number];

export const TERMINAL_WORKFLOW_RUN_STATES = ["SUCCEEDED", "FAILED"] as const;

export type TerminalWorkflowRunState =
  (typeof TERMINAL_WORKFLOW_RUN_STATES)[number];

export const WORKFLOW_NODE_RUN_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export type WorkflowNodeRunState = (typeof WORKFLOW_NODE_RUN_STATES)[number];

export const TERMINAL_WORKFLOW_NODE_RUN_STATES = [
  "SUCCEEDED",
  "FAILED",
] as const;

export type TerminalWorkflowNodeRunState =
  (typeof TERMINAL_WORKFLOW_NODE_RUN_STATES)[number];
