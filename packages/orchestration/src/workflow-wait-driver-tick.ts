import type { ProcessDueTimerWaits } from "./process-due-timer-waits.js";
import type { ProcessResolvableEventWaits } from "./process-resolvable-event-waits.js";

export const DEFAULT_WORKFLOW_WAIT_DRIVER_BATCH_LIMIT = 50;

export interface WorkflowWaitDriverTickDependencies {
  readonly processDueTimerWaits: ProcessDueTimerWaits;
  readonly processResolvableEventWaits: ProcessResolvableEventWaits;
  readonly batchLimit?: number;
}

export class WorkflowWaitDriverTick {
  constructor(private readonly deps: WorkflowWaitDriverTickDependencies) {}

  async execute(now: Date): Promise<void> {
    const limit =
      this.deps.batchLimit ?? DEFAULT_WORKFLOW_WAIT_DRIVER_BATCH_LIMIT;
    await this.deps.processDueTimerWaits.execute(now, limit);
    await this.deps.processResolvableEventWaits.execute(now, limit);
  }
}
