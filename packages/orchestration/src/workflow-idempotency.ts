import type { WorkflowRunId } from "@osva/contracts";

export function workflowNodeRunIdempotencyKey(
  workflowRunId: WorkflowRunId,
  workflowNodeKey: string,
): string {
  return `workflow:${workflowRunId}:${workflowNodeKey}`;
}
