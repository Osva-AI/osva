import {
  DomainInvariantError,
  type WorkflowTimerWaitResolutionRepository,
  type WorkflowWait,
  type WorkflowWaitRepository,
} from "@osva/domain";

export interface ProcessDueTimerWaitsDependencies {
  readonly workflowWaits: WorkflowWaitRepository;
  readonly timerWaitResolution: WorkflowTimerWaitResolutionRepository;
}

export class ProcessDueTimerWaits {
  constructor(private readonly deps: ProcessDueTimerWaitsDependencies) {}

  async execute(now: Date, limit: number): Promise<readonly WorkflowWait[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new DomainInvariantError(
        "ProcessDueTimerWaits limit must be a positive integer.",
      );
    }

    const due = await this.deps.workflowWaits.listDueTimerWorkflowWaits(
      now,
      limit,
    );
    const resolved: WorkflowWait[] = [];

    for (const wait of due) {
      const persisted =
        await this.deps.timerWaitResolution.resolveWorkflowTimerWait(
          wait.workflowNodeRunId,
          now,
        );
      if (persisted.resolution !== undefined) {
        resolved.push(persisted);
      }
    }

    return resolved;
  }
}
