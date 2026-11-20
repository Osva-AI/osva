import type {
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetPeriodLedgerV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { InferenceBudgetPeriodLedgerReadPort } from "@osva/domain";

export class MemoryInferenceBudgetPeriodLedgerRepository implements InferenceBudgetPeriodLedgerReadPort {
  private readonly ledgers = new Map<string, InferenceBudgetPeriodLedgerV1>();

  ledgerKey(workspaceId: WorkspaceId, periodKey: InferenceBudgetPeriodKeyV1) {
    return `${workspaceId as string}:${periodKey as string}`;
  }

  setLedger(ledger: InferenceBudgetPeriodLedgerV1): void {
    this.ledgers.set(
      this.ledgerKey(ledger.workspaceId, ledger.period.periodKey),
      ledger,
    );
  }

  async loadPeriodLedger(
    workspaceId: WorkspaceId,
    periodKey: InferenceBudgetPeriodKeyV1,
  ): Promise<InferenceBudgetPeriodLedgerV1 | null> {
    return this.ledgers.get(this.ledgerKey(workspaceId, periodKey)) ?? null;
  }
}
