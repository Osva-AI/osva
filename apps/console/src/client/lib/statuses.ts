export type StatusVisualCategory =
  "neutral" | "active" | "success" | "error" | "inactive";

const RUN_ACTIVE = new Set(["PENDING", "QUEUED", "RUNNING"]);
const RUN_TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"]);

const ATTEMPT_ACTIVE = new Set(["PENDING", "RUNNING"]);
const ATTEMPT_TERMINAL = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
]);

export function runStatusCategory(status: string): StatusVisualCategory {
  if (RUN_ACTIVE.has(status)) {
    return status === "RUNNING" ? "active" : "neutral";
  }
  if (status === "SUCCEEDED") {
    return "success";
  }
  if (status === "FAILED" || status === "TIMED_OUT") {
    return "error";
  }
  if (status === "CANCELLED") {
    return "inactive";
  }
  return "neutral";
}

export function attemptStatusCategory(status: string): StatusVisualCategory {
  if (ATTEMPT_ACTIVE.has(status)) {
    return status === "RUNNING" ? "active" : "neutral";
  }
  if (status === "SUCCEEDED") {
    return "success";
  }
  if (status === "FAILED" || status === "TIMED_OUT") {
    return "error";
  }
  if (status === "CANCELLED") {
    return "inactive";
  }
  return "neutral";
}

export function isRunLive(status: string): boolean {
  return RUN_ACTIVE.has(status);
}

export function isAttemptLive(status: string): boolean {
  return ATTEMPT_ACTIVE.has(status);
}

export function isRunTerminal(status: string): boolean {
  return RUN_TERMINAL.has(status);
}

export function isAttemptTerminal(status: string): boolean {
  return ATTEMPT_TERMINAL.has(status);
}

const WORKFLOW_RUN_ACTIVE = new Set(["PENDING", "RUNNING", "WAITING"]);
const WORKFLOW_RUN_TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function workflowRunStatusCategory(
  status: string,
): StatusVisualCategory {
  if (WORKFLOW_RUN_ACTIVE.has(status)) {
    return status === "RUNNING" ? "active" : "neutral";
  }
  if (status === "SUCCEEDED") {
    return "success";
  }
  if (status === "FAILED") {
    return "error";
  }
  if (status === "CANCELLED") {
    return "inactive";
  }
  return "neutral";
}

export function workflowNodeRunStatusCategory(
  status: string,
): StatusVisualCategory {
  if (status === "RUNNING") {
    return "active";
  }
  if (status === "WAITING" || status === "PENDING") {
    return "neutral";
  }
  if (status === "SUCCEEDED") {
    return "success";
  }
  if (status === "FAILED") {
    return "error";
  }
  if (status === "SKIPPED" || status === "CANCELLED") {
    return "inactive";
  }
  return "neutral";
}

export function isWorkflowRunLive(status: string): boolean {
  return WORKFLOW_RUN_ACTIVE.has(status);
}

export function isWorkflowRunTerminal(status: string): boolean {
  return WORKFLOW_RUN_TERMINAL.has(status);
}
