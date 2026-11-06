import type { JobQueue, RunId, WorkspaceId } from "@osva-ai/contracts";
import { RUN_RECOVERY_METADATA_VERSION } from "@osva-ai/contracts";
import type {
  RunCheckpointRepository,
  RunOperationJournalRepository,
  RunRepository,
} from "@osva/domain";
import {
  assessRunRecoveryEligibility,
  buildBlockedRecoveryMetadata,
} from "@osva/domain";

export interface RecoverInterruptedRunCommand {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly now: Date;
  readonly newRunAttemptId: import("@osva-ai/contracts").RunAttemptId;
  readonly automatic: boolean;
}

export interface RecoverInterruptedRunDependencies {
  readonly runs: RunRepository;
  readonly checkpoints: RunCheckpointRepository;
  readonly operationJournal: RunOperationJournalRepository;
  readonly queue: JobQueue;
}

export type RecoverInterruptedRunResult =
  | {
      readonly outcome: "scheduled";
      readonly runAttemptId: import("@osva-ai/contracts").RunAttemptId;
    }
  | {
      readonly outcome: "already_scheduled";
      readonly runAttemptId: import("@osva-ai/contracts").RunAttemptId;
    }
  | {
      readonly outcome: "ineligible";
      readonly code: string;
      readonly message: string;
    }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "conflict" };

/**
 * Shared manual/automatic recovery path with identical safety eligibility checks.
 */
export class RecoverInterruptedRun {
  constructor(private readonly deps: RecoverInterruptedRunDependencies) {}

  async execute(
    command: RecoverInterruptedRunCommand,
  ): Promise<RecoverInterruptedRunResult> {
    const run = await this.deps.runs.findRunById(command.runId);
    if (run === null || run.workspaceId !== command.workspaceId) {
      return { outcome: "not_found" };
    }

    const attempts = await this.deps.runs.listRunAttempts(command.runId);
    const hasPendingRunAttempt = attempts.some(
      (attempt) => attempt.status === "PENDING" || attempt.status === "RUNNING",
    );

    if (run.status === "QUEUED") {
      const pending = attempts.find((attempt) => attempt.status === "PENDING");
      if (pending !== undefined) {
        return {
          outcome: "already_scheduled",
          runAttemptId: pending.id,
        };
      }
    }

    const eligibility = await assessRunRecoveryEligibility({
      run,
      checkpoints: this.deps.checkpoints,
      operationJournal: this.deps.operationJournal,
      hasPendingRunAttempt,
    });

    if (!eligibility.eligible) {
      if (
        eligibility.blockAutomaticRecovery &&
        run.recoveryMetadata !== undefined
      ) {
        const blocked = buildBlockedRecoveryMetadata(run.recoveryMetadata, {
          code: eligibility.code,
          message: eligibility.message,
          at: command.now.toISOString(),
        });
        await this.deps.runs.updateInterruptedRunRecoveryMetadata({
          workspaceId: command.workspaceId,
          runId: command.runId,
          recoveryMetadata: blocked,
          now: command.now,
        });
      }
      return {
        outcome: "ineligible",
        code: eligibility.code,
        message: eligibility.message,
      };
    }

    const current = run.recoveryMetadata;
    const nextMetadata = {
      version: RUN_RECOVERY_METADATA_VERSION,
      recoveryAttemptCount: (current?.recoveryAttemptCount ?? 0) + 1,
      automaticRecoveryEnabled: current?.automaticRecoveryEnabled ?? false,
      lastRecoveryAt: command.now.toISOString(),
    };

    const scheduled = await this.deps.runs.scheduleRecoveryRunAttempt({
      workspaceId: command.workspaceId,
      runId: command.runId,
      newRunAttemptId: command.newRunAttemptId,
      now: command.now,
      recoveryMetadata: nextMetadata,
    });

    if (scheduled === null) {
      return { outcome: "conflict" };
    }

    await this.deps.queue.enqueue(scheduled.runAttempt.id);
    return {
      outcome: "scheduled",
      runAttemptId: scheduled.runAttempt.id,
    };
  }
}
