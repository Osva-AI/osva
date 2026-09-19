import type { WorkflowNodeRunId } from "@osva/contracts";

import type { WorkflowWait } from "../workflow-wait.js";

/**
 * Atomic TIMER resolution for one WorkflowWait row.
 * Implementations lock WorkflowRun then WorkflowWait, skip resolution when the
 * run is terminal, and persist resolution inside one correctness boundary.
 */
export interface WorkflowTimerWaitResolutionRepository {
  resolveWorkflowTimerWait(
    workflowNodeRunId: WorkflowNodeRunId,
    now: Date,
  ): Promise<WorkflowWait>;
}
