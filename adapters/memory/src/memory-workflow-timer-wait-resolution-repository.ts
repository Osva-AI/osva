import type { WorkflowNodeRunId } from "@osva/contracts";
import {
  WorkflowWaitNotFoundError,
  isTerminalWorkflowRunState,
  type WorkflowTimerWaitResolutionRepository,
  type WorkflowWait,
} from "@osva/domain";

import type { MemoryWorkflowRunRepository } from "./memory-workflow-run-repository.js";
import type { MemoryWorkflowWaitRepository } from "./memory-workflow-wait-repository.js";

export class MemoryWorkflowTimerWaitResolutionRepository implements WorkflowTimerWaitResolutionRepository {
  constructor(
    private readonly workflowWaits: MemoryWorkflowWaitRepository,
    private readonly workflowRuns: MemoryWorkflowRunRepository,
  ) {}

  async resolveWorkflowTimerWait(
    workflowNodeRunId: WorkflowNodeRunId,
    now: Date,
  ): Promise<WorkflowWait> {
    const wait =
      await this.workflowWaits.findWorkflowWaitByWorkflowNodeRunId(
        workflowNodeRunId,
      );
    if (wait === null) {
      throw new WorkflowWaitNotFoundError(workflowNodeRunId);
    }

    const workflowRun = await this.workflowRuns.findWorkflowRunById(
      wait.workflowRunId,
    );
    if (
      workflowRun !== null &&
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return wait;
    }

    if (wait.resolution !== undefined || wait.kind !== "TIMER") {
      return wait;
    }

    return this.workflowWaits.saveWorkflowWaitResolution(
      wait.resolveTimer(now),
    );
  }
}
