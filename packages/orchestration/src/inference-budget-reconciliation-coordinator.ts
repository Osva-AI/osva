import type { InferenceBudgetReconciliationTick } from "./inference-budget-reconciliation-tick.js";

export interface InferenceBudgetReconciliationCoordinatorOptions {
  readonly tick: Pick<InferenceBudgetReconciliationTick, "execute">;
  readonly batchLimit: number;
}

export class InferenceBudgetReconciliationCoordinator {
  private inFlight: Promise<void> | null = null;
  private drainRequested = false;

  constructor(
    private readonly options: InferenceBudgetReconciliationCoordinatorOptions,
  ) {}

  schedule(): void {
    if (this.drainRequested || this.inFlight !== null) {
      return;
    }
    this.inFlight = this.options.tick
      .execute()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = null;
      });
  }

  async drain(): Promise<void> {
    this.drainRequested = true;
    if (this.inFlight !== null) {
      await this.inFlight;
    }
  }
}
