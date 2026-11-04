import type { WorkflowDefinitionNode } from "./workflow-definition";
import type { WorkflowNodeExecutionStatus } from "./workflow-node-run-overlay";

/** User-facing WorkflowRun.status labels on Workflow Run Detail. */
export function workflowRunExecutionStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "RUNNING":
      return "Running";
    case "WAITING":
      return "Waiting";
    case "SUCCEEDED":
      return "Succeeded";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status.replaceAll("_", " ");
  }
}

export function workflowNodeDisplayTitle(node: WorkflowDefinitionNode): string {
  if (node.type === "APPROVAL") {
    const title = node.title;
    if (typeof title === "string" && title.trim().length > 0) {
      return title.trim();
    }
  }
  return node.key;
}

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

const TERMINAL_NODE_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
]);

/** Neutral copy when workflow run detail has no matching ApprovalRequest. */
export function describeMissingApprovalRequestCopy(
  workflowNodeRunStatus: string | undefined,
): string {
  if (
    workflowNodeRunStatus !== undefined &&
    TERMINAL_NODE_STATUSES.has(workflowNodeRunStatus)
  ) {
    return "No approval request record is included in the workflow run detail for this node.";
  }
  if (workflowNodeRunStatus === "WAITING") {
    return "Approval request has not been returned for this waiting node.";
  }
  return "No approval request record is available for this node in the workflow run detail.";
}
