import type { ProcessBatchInferenceJobs } from "./process-batch-inference-jobs.js";

export interface BatchInferenceRecoveryCoordinatorOptions {
  readonly processor: Pick<ProcessBatchInferenceJobs, "execute"> & {
    readonly abortInFlight?: () => void;
  };
  readonly batchLimit: number;
}

export class BatchInferenceRecoveryCoordinator {
  private inFlight: Promise<void> | null = null;
  private drainRequested = false;

  constructor(
    private readonly options: BatchInferenceRecoveryCoordinatorOptions,
  ) {}

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
