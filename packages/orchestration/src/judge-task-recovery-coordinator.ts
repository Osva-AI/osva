import type { ProcessEvaluationJudgeTasks } from "@osva/domain";

export interface JudgeTaskRecoveryCoordinatorOptions {
  readonly processor: Pick<ProcessEvaluationJudgeTasks, "execute"> & {
    readonly abortInFlight?: () => void;
  };
  readonly batchLimit: number;
}

/**
 * Runs judge-task recovery batches without blocking the execution recovery tick.
 * At most one batch executes at a time; shutdown drains in-flight work.
 */
export class JudgeTaskRecoveryCoordinator {
  private inFlight: Promise<void> | null = null;
  private drainRequested = false;

  constructor(private readonly options: JudgeTaskRecoveryCoordinatorOptions) {}

  schedule(): void {
    if (this.drainRequested || this.inFlight !== null) {
      return;
    }

    this.inFlight = this.options.processor
      .execute({ batchLimit: this.options.batchLimit })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = null;
      });
  }

  async drain(): Promise<void> {
    this.drainRequested = true;
    this.options.processor.abortInFlight?.();
    if (this.inFlight !== null) {
      await this.inFlight;
    }
  }
}
