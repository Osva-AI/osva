import type { WorkflowNodeExecutionStatus } from "./workflow-node-run-overlay";

export function describeWorkflowNodeExecutionStatus(status: string): string {
  switch (status as WorkflowNodeExecutionStatus) {
    case "PENDING":
      return "Pending";
    case "RUNNING":
      return "Running";
    case "SUCCEEDED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "SKIPPED":
      return "Skipped";
    case "CANCELLED":
      return "Cancelled";
    case "WAITING":
      return "Waiting";
    default:
      return status;
  }
}

export function describeWorkflowNodeWaitingDetail(input: {
  readonly nodeType: string;
  readonly waitKind?: string;
}): string {
  if (input.nodeType === "APPROVAL") {
    return "Waiting for human approval";
  }
  if (input.nodeType === "WAIT") {
    if (input.waitKind === "DURATION") {
      return "Waiting for a timer";
    }
    if (input.waitKind === "UNTIL") {
      return "Waiting until a scheduled time";
    }
    if (input.waitKind === "EVENT") {
      return "Waiting for an external event";
    }
    return "Waiting";
  }
  return "Waiting";
}
