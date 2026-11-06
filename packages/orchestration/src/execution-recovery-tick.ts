import {
  DEFAULT_EXECUTION_RECOVERY_BATCH_LIMIT,
  DEFAULT_MAX_RECOVERY_ATTEMPTS,
  DEFAULT_TRANSPORT_REPAIR_BATCH_LIMIT,
  EXECUTION_INTERRUPTED_ERROR_CODE,
  RUN_RECOVERY_METADATA_VERSION,
  isDeclarativeAgentRuntime,
} from "@osva-ai/contracts";
import type { JobQueue, RunAttemptId, RunId } from "@osva-ai/contracts";
import type {
  AgentRepository,
  RunCheckpointRepository,
  RunOperationJournalRepository,
  RunRepository,
} from "@osva/domain";
import { RecoverInterruptedRun } from "./recover-interrupted-run.js";
import {
  elapsedMs,
  OSVA_METRIC,
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
  readonly checkpoints?: RunCheckpointRepository;
  readonly operationJournal?: RunOperationJournalRepository;
  readonly agents?: AgentRepository;
  readonly clock?: { now(): Date };
  readonly expiredBatchLimit?: number;
  readonly transportBatchLimit?: number;
  readonly interruptedBatchLimit?: number;
  readonly instrumentation?: OsvaInstrumentation;
  readonly logger?: ExecutionRecoveryTickLogger;
  readonly createRunAttemptId?: () => RunAttemptId;
}

/**
 * Worker-owned recovery tick. PostgreSQL remains lifecycle authority.
 * Legacy runs without checkpoints still fail in place on lease expiry.
 * Checkpoint-enabled runs may enter INTERRUPTED and schedule successor attempts.
 */
export class ExecutionRecoveryTick {
  private readonly expiredBatchLimit: number;
  private readonly transportBatchLimit: number;
  private readonly interruptedBatchLimit: number;
  private readonly clock: { now(): Date };

  constructor(private readonly deps: ExecutionRecoveryTickDependencies) {
    this.expiredBatchLimit =
      deps.expiredBatchLimit ?? DEFAULT_EXECUTION_RECOVERY_BATCH_LIMIT;
    this.transportBatchLimit =
      deps.transportBatchLimit ?? DEFAULT_TRANSPORT_REPAIR_BATCH_LIMIT;
    this.interruptedBatchLimit =
      deps.interruptedBatchLimit ?? DEFAULT_EXECUTION_RECOVERY_BATCH_LIMIT;
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async execute(): Promise<void> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    const startedAt = performance.now();
    try {
      await telemetry.withSpan(
        OSVA_SPAN.EXECUTION_RECOVERY,
        undefined,
        async () => {
          await this.failExpiredLeases(telemetry);
          await this.dispatchInterruptedRecoveries(telemetry);
          await this.repairQueuedDeliveries(telemetry);
        },
      );
    } catch (error) {
      telemetry.recordCounter(OSVA_METRIC.RECOVERY_ERRORS, 1, {
        kind: "tick",
      });
      throw error;
    } finally {
      telemetry.recordHistogram(
        OSVA_METRIC.RECOVERY_DURATION_MS,
        elapsedMs(startedAt, performance.now()),
      );
    }
  }

  private async failExpiredLeases(
    telemetry: OsvaInstrumentation,
  ): Promise<void> {
    const expired = await this.deps.runs.listExpiredLeasedRunningAttempts(
      this.expiredBatchLimit,
    );

    for (const attempt of expired) {
      try {
        const run = await this.deps.runs.findRunById(attempt.runId);
        if (run === null) {
          continue;
        }

        const latestCheckpoint =
          this.deps.checkpoints === undefined
            ? null
            : await this.deps.checkpoints.findLatestByRun(
                run.workspaceId,
                run.id,
              );

        const recoveryMetadata = await this.buildRecoveryMetadata(run.id);

        const command = {
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
        };

        const result =
          latestCheckpoint !== null
            ? await this.deps.runs.interruptExpiredLeasedAttemptForRecovery({
                ...command,
                recoveryMetadata: recoveryMetadata ?? {
                  version: RUN_RECOVERY_METADATA_VERSION,
                  recoveryAttemptCount: 0,
                  automaticRecoveryEnabled: false,
                },
              })
            : await this.deps.runs.failExpiredLeasedAttempt(command);

        if (result === null) {
          this.deps.logger?.info("execution.recovery.lease_unclaimed", {
            runAttemptId: attempt.id,
            runId: attempt.runId,
          });
          continue;
        }

        telemetry.recordCounter(OSVA_METRIC.RECOVERY_LEASE_INTERRUPTED, 1);
        this.deps.logger?.info("execution.recovery.lease_interrupted", {
          runAttemptId: result.runAttempt.id,
          runId: result.run.id,
          runStatus: result.run.status,
          errorCode: EXECUTION_INTERRUPTED_ERROR_CODE,
        });
      } catch (error) {
        telemetry.recordCounter(OSVA_METRIC.RECOVERY_ERRORS, 1, {
          kind: "lease",
        });
        this.deps.logger?.error("execution.recovery.lease_failed", {
          runAttemptId: attempt.id,
          runId: attempt.runId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }
  }

  private async dispatchInterruptedRecoveries(
    telemetry: OsvaInstrumentation,
  ): Promise<void> {
    const interrupted = await this.deps.runs.listInterruptedRuns(
      this.interruptedBatchLimit,
    );

    const createId = this.deps.createRunAttemptId;
    if (
      createId === undefined ||
      this.deps.checkpoints === undefined ||
      this.deps.operationJournal === undefined
    ) {
      return;
    }

    const recover = new RecoverInterruptedRun({
      runs: this.deps.runs,
      checkpoints: this.deps.checkpoints,
      operationJournal: this.deps.operationJournal,
      queue: this.deps.queue,
    });

    for (const run of interrupted) {
      const metadata = run.recoveryMetadata;
      if (metadata?.automaticRecoveryEnabled !== true) {
        continue;
      }

      if (metadata.recoveryAttemptCount >= DEFAULT_MAX_RECOVERY_ATTEMPTS) {
        continue;
      }

      if (metadata.blocked !== undefined) {
        continue;
      }

      try {
        const result = await recover.execute({
          workspaceId: run.workspaceId,
          runId: run.id,
          now: this.clock.now(),
          newRunAttemptId: createId(),
          automatic: true,
        });

        if (result.outcome === "scheduled") {
          telemetry.recordCounter(OSVA_METRIC.RECOVERY_TRANSPORT_REPAIRED, 1);
          this.deps.logger?.info("execution.recovery.successor_scheduled", {
            runId: run.id as RunId,
            runAttemptId: result.runAttemptId,
          });
        } else if (result.outcome === "ineligible") {
          this.deps.logger?.info("execution.recovery.successor_ineligible", {
            runId: run.id,
            code: result.code,
          });
        }
      } catch (error) {
        telemetry.recordCounter(OSVA_METRIC.RECOVERY_ERRORS, 1, {
          kind: "successor",
        });
        this.deps.logger?.error("execution.recovery.successor_failed", {
          runId: run.id,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }
  }

  private async buildRecoveryMetadata(runId: RunId) {
    const run = await this.deps.runs.findRunById(runId);
    if (run === null || this.deps.agents === undefined) {
      return {
        version: RUN_RECOVERY_METADATA_VERSION,
        recoveryAttemptCount: 0,
        automaticRecoveryEnabled: false,
      };
    }

    const agentVersion = await this.deps.agents.findAgentVersionById(
      run.effectiveBindings.agentVersionId,
    );
    if (
      agentVersion === null ||
      !isDeclarativeAgentRuntime(agentVersion.manifest.runtime)
    ) {
      return {
        version: RUN_RECOVERY_METADATA_VERSION,
        recoveryAttemptCount: 0,
        automaticRecoveryEnabled: false,
      };
    }

    return {
      version: RUN_RECOVERY_METADATA_VERSION,
      recoveryAttemptCount: 0,
      automaticRecoveryEnabled:
        agentVersion.manifest.runtime.config.automaticRecoveryEnabled === true,
    };
  }

  private async repairQueuedDeliveries(
    telemetry: OsvaInstrumentation,
  ): Promise<void> {
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
        const enqueue = await this.deps.queue.enqueue(delivery.runAttempt.id);
        if (enqueue.outcome === "enqueued") {
          telemetry.recordCounter(OSVA_METRIC.RECOVERY_TRANSPORT_REPAIRED, 1);
          this.deps.logger?.info("execution.recovery.transport_repaired", {
            runAttemptId: delivery.runAttempt.id,
            runId: delivery.run.id,
          });
        } else {
          this.deps.logger?.info(
            "execution.recovery.transport_already_present",
            {
              runAttemptId: delivery.runAttempt.id,
              runId: delivery.run.id,
            },
          );
        }
      } catch (error) {
        telemetry.recordCounter(OSVA_METRIC.RECOVERY_ERRORS, 1, {
          kind: "transport",
        });
        this.deps.logger?.error("execution.recovery.transport_repair_failed", {
          runAttemptId: delivery.runAttempt.id,
          runId: delivery.run.id,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }
  }
}
