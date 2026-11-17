import type { ProcessEvaluationComparisonPairwiseTasks } from "@osva/domain";

export interface PairwiseTaskRecoveryCoordinatorOptions {
  readonly processor: Pick<
    ProcessEvaluationComparisonPairwiseTasks,
    "execute"
  > & {
    readonly abortInFlight?: () => void;
  };
  readonly batchLimit: number;
}

/** Non-blocking pairwise comparison task recovery batches (mirrors judge coordinator). */
export class PairwiseTaskRecoveryCoordinator {
  private inFlight: Promise<void> | null = null;
  private drainRequested = false;

  constructor(
    private readonly options: PairwiseTaskRecoveryCoordinatorOptions,
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
