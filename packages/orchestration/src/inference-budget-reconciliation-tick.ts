import {
  DEFAULT_INFERENCE_BUDGET_RECONCILIATION_BATCH_LIMIT,
  type InferenceBudgetAdmissionPort,
  type InferenceBudgetPolicyPort,
  type InferenceBudgetRecoveryPort,
  type InferenceBudgetReservationSnapshotV1,
  type WorkspaceId,
} from "@osva-ai/contracts";
import { evaluateInferenceBudgetRecoveryDisposition } from "@osva/domain";

export interface InferenceBudgetReconciliationTickLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface InferenceBudgetReconciliationTickDependencies {
  readonly recovery: InferenceBudgetRecoveryPort;
  readonly admission: InferenceBudgetAdmissionPort;
  readonly policies: InferenceBudgetPolicyPort;
  readonly clock?: { now(): Date };
  readonly batchLimit?: number;
  readonly logger?: InferenceBudgetReconciliationTickLogger;
}

export interface InferenceBudgetReconciliationTickResultV1 {
  readonly scanned: number;
  readonly released: number;
  readonly markedReconciliationRequired: number;
}

/**
 * Bounded reservation recovery for stale ADMITTED (never-started) and lease-loss
 * ambiguous provider-started rows. Does not replay provider HTTP.
 */
export class InferenceBudgetReconciliationTick {
  private readonly batchLimit: number;
  private readonly clock: { now(): Date };

  constructor(
    private readonly deps: InferenceBudgetReconciliationTickDependencies,
  ) {
    this.batchLimit =
      deps.batchLimit ?? DEFAULT_INFERENCE_BUDGET_RECONCILIATION_BATCH_LIMIT;
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async execute(): Promise<InferenceBudgetReconciliationTickResultV1> {
    const now = this.clock.now();
    const candidates = await this.deps.recovery.listRecoveryCandidates({
      limit: this.batchLimit,
      now,
    });

    let released = 0;
    let markedReconciliationRequired = 0;

    for (const candidate of candidates) {
      const policy = await this.deps.policies.findRuntimePolicyByWorkspaceId(
        candidate.reservation.workspaceId as WorkspaceId,
      );
      const disposition = evaluateInferenceBudgetRecoveryDisposition({
        reservation: candidate.reservation,
        nowMs: now.getTime(),
        admittedAtMs: candidate.admittedAtMs,
        leaseLost: candidate.leaseLost,
        policy: policy?.definition,
      });

      try {
        if (disposition.kind === "RELEASE_STALE_ADMITTED") {
          const ledger = await this.requirePeriodLedger(candidate.reservation);
          await this.deps.admission.release({
            workspaceId: candidate.reservation.workspaceId,
            reservation: candidate.reservation,
            periodLedger: ledger,
          });
          released += 1;
          continue;
        }

        if (disposition.kind === "MARK_RECONCILIATION_REQUIRED") {
          const ledger = await this.requirePeriodLedger(candidate.reservation);
          await this.deps.admission.markReconciliationRequired({
            workspaceId: candidate.reservation.workspaceId,
            reservation: candidate.reservation,
            periodLedger: ledger,
          });
          markedReconciliationRequired += 1;
        }
      } catch (error) {
        this.deps.logger?.error("inference_budget.recovery_tick_item_failed", {
          reservationId: candidate.reservation.id,
          error: String(error),
        });
      }
    }

    const result = {
      scanned: candidates.length,
      released,
      markedReconciliationRequired,
    };
    this.deps.logger?.info("inference_budget.recovery_tick", result);
    return result;
  }

  private async requirePeriodLedger(
    reservation: InferenceBudgetReservationSnapshotV1,
  ) {
    const ledger = await this.deps.admission.loadPeriodLedger(
      reservation.workspaceId,
      reservation.periodKey,
    );
    if (ledger === null) {
      throw new Error("Period ledger missing for recovery tick.");
    }
    return ledger;
  }
}
