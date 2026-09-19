import type { WorkflowNodeRunId } from "@osva/contracts";

import type { WorkflowWait } from "../workflow-wait.js";

/**
 * Atomic EVENT-vs-TIMEOUT decision boundary for one WorkflowWait row.
 * Implementations own row locking, durable candidate lookup, domain decision,
 * and resolution persistence inside one correctness boundary.
 */
export interface WorkflowEventWaitResolutionRepository {
  resolveWorkflowEventWait(
    workflowNodeRunId: WorkflowNodeRunId,
    now: Date,
  ): Promise<WorkflowWait>;
}
