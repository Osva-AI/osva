import type { WorkflowRunId } from "@osva-ai/contracts";

export function workflowNodeRunIdempotencyKey(
  workflowRunId: WorkflowRunId,
  workflowNodeKey: string,
): string {
  return `workflow:${workflowRunId}:${workflowNodeKey}`;
}
