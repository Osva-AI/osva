import {
  DEFAULT_EXECUTION_RECOVERY_BATCH_LIMIT,
  DEFAULT_TRANSPORT_REPAIR_BATCH_LIMIT,
  EXECUTION_INTERRUPTED_ERROR_CODE,
} from "@osva-ai/contracts";
import type { JobQueue } from "@osva-ai/contracts";
import type { RunRepository } from "@osva/domain";
import {
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";

export interface ExecutionRecoveryTickLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface ExecutionRecoveryTickDependencies {
  readonly runs: RunRepository;
  readonly queue: JobQueue;
  readonly clock?: { now(): Date };
  readonly expiredBatchLimit?: number;
  readonly transportBatchLimit?: number;
  readonly instrumentation?: OsvaInstrumentation;
  readonly logger?: ExecutionRecoveryTickLogger;
}

/**
 * Worker-owned recovery tick. PostgreSQL remains lifecycle authority: expired
 * leased RUNNING attempts are failed in place. QUEUED/PENDING deliveries are
 * repaired onto the existing RunAttempt identity. The tick never calls
 * runtime.execute() and never creates a subsequent logical RunAttempt.
 *
 * Multiple worker replicas may run this tick; correctness is the CAS in
 * failExpiredLeasedAttempt and BullMQ job-id uniqueness.
 */
export class ExecutionRecoveryTick {
  private readonly expiredBatchLimit: number;
  private readonly transportBatchLimit: number;
  private readonly clock: { now(): Date };

  constructor(private readonly deps: ExecutionRecoveryTickDependencies) {
    this.expiredBatchLimit =
      deps.expiredBatchLimit ?? DEFAULT_EXECUTION_RECOVERY_BATCH_LIMIT;
    this.transportBatchLimit =
      deps.transportBatchLimit ?? DEFAULT_TRANSPORT_REPAIR_BATCH_LIMIT;
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async execute(): Promise<void> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    await telemetry.withSpan(
      OSVA_SPAN.EXECUTION_RECOVERY,
      undefined,
      async () => {
        await this.failExpiredLeases();
        await this.repairQueuedDeliveries();
      },
    );
  }

  private async failExpiredLeases(): Promise<void> {
    const expired = await this.deps.runs.listExpiredLeasedRunningAttempts(
      this.expiredBatchLimit,
    );

    for (const attempt of expired) {
      try {
        const result = await this.deps.runs.failExpiredLeasedAttempt({
          runAttemptId: attempt.id,
          generation: attempt.executionGeneration,
          now: this.clock.now(),
          error: {
            code: EXECUTION_INTERRUPTED_ERROR_CODE,
            message:
              "Execution lease expired; the owning worker lost heartbeat before persisting a terminal outcome.",
          },
          infrastructureMetadata: {
            ...attempt.infrastructureMetadata,
            recovery: {
              reason: "LEASE_EXPIRED",
              owner: attempt.executionOwner,
              generation: attempt.executionGeneration,
              leaseExpiresAt: attempt.leaseExpiresAt?.toISOString(),
            },
          },
        });

        if (result === null) {
          this.deps.logger?.info("execution.recovery.lease_unclaimed", {
            runAttemptId: attempt.id,
            runId: attempt.runId,
          });
          continue;
        }

        this.deps.logger?.info("execution.recovery.lease_interrupted", {
          runAttemptId: result.runAttempt.id,
          runId: result.run.id,
          errorCode: EXECUTION_INTERRUPTED_ERROR_CODE,
        });
      } catch (error) {
        this.deps.logger?.error("execution.recovery.lease_failed", {
          runAttemptId: attempt.id,
          runId: attempt.runId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }
  }

  private async repairQueuedDeliveries(): Promise<void> {
    const deliveries = await this.deps.runs.listQueuedPendingDeliveries(
      this.transportBatchLimit,
    );

    for (const delivery of deliveries) {
      if (
        delivery.run.status !== "QUEUED" ||
        delivery.runAttempt.status !== "PENDING"
      ) {
        continue;
      }

      try {
        await this.deps.queue.enqueue(delivery.runAttempt.id);
        this.deps.logger?.info("execution.recovery.transport_repaired", {
          runAttemptId: delivery.runAttempt.id,
          runId: delivery.run.id,
        });
      } catch (error) {
        this.deps.logger?.error("execution.recovery.transport_repair_failed", {
          runAttemptId: delivery.runAttempt.id,
          runId: delivery.run.id,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }
  }
}
