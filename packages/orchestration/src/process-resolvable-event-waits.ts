import {
  DomainInvariantError,
  type WorkflowEventWaitResolutionRepository,
  type WorkflowWait,
  type WorkflowWaitRepository,
} from "@osva/domain";

export interface ProcessResolvableEventWaitsDependencies {
  readonly workflowWaits: WorkflowWaitRepository;
  readonly eventWaitResolution: WorkflowEventWaitResolutionRepository;
}

export class ProcessResolvableEventWaits {
  constructor(private readonly deps: ProcessResolvableEventWaitsDependencies) {}

  async execute(now: Date, limit: number): Promise<readonly WorkflowWait[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new DomainInvariantError(
        "ProcessResolvableEventWaits limit must be a positive integer.",
      );
    }

    const candidates =
      await this.deps.workflowWaits.listResolvableEventWorkflowWaits(
        now,
        limit,
      );
    const resolved: WorkflowWait[] = [];

    for (const wait of candidates) {
      const outcome =
        await this.deps.eventWaitResolution.resolveWorkflowEventWait(
          wait.workflowNodeRunId,
          now,
        );
      if (outcome.resolution !== undefined) {
        resolved.push(outcome);
      }
    }

    return resolved;
  }
}
