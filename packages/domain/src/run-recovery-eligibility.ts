import {
  DEFAULT_MAX_RECOVERY_ATTEMPTS,
  RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
  type RunId,
  type RunRecoveryMetadataV1,
  type WorkspaceId,
} from "@osva-ai/contracts";
import type { Run } from "./run.js";
import type { RunCheckpointRepository } from "./ports/run-checkpoint-repository.js";
import type { RunOperationJournalRepository } from "./ports/run-operation-journal-repository.js";
import { isSideEffectSafeToAutoReplay } from "./run-operation-idempotency.js";

export const RECOVERY_NOT_CHECKPOINTED_CODE = "RECOVERY_NOT_CHECKPOINTED";
export const RECOVERY_ATTEMPT_LIMIT_CODE = "RECOVERY_ATTEMPT_LIMIT_EXCEEDED";
export const RECOVERY_ACTIVE_ATTEMPT_CODE = "RECOVERY_ACTIVE_ATTEMPT_EXISTS";

export type RecoveryEligibilityResult =
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly code: string;
      readonly message: string;
      readonly blockAutomaticRecovery: boolean;
    };

export async function assessRunRecoveryEligibility(input: {
  readonly run: Run;
  readonly checkpoints: RunCheckpointRepository;
  readonly operationJournal: RunOperationJournalRepository;
  readonly hasPendingRunAttempt: boolean;
}): Promise<RecoveryEligibilityResult> {
  const metadata = input.run.recoveryMetadata;

  if (metadata?.blocked !== undefined) {
    return {
      eligible: false,
      code: metadata.blocked.code,
      message: metadata.blocked.message,
      blockAutomaticRecovery: true,
    };
  }

  if (
    metadata !== undefined &&
    metadata.recoveryAttemptCount >= DEFAULT_MAX_RECOVERY_ATTEMPTS
  ) {
    return {
      eligible: false,
      code: RECOVERY_ATTEMPT_LIMIT_CODE,
      message: "Maximum recovery attempts exceeded for this run.",
      blockAutomaticRecovery: true,
    };
  }

  if (input.run.status !== "INTERRUPTED") {
    return {
      eligible: false,
      code: "RUN_NOT_INTERRUPTED",
      message: "Run is not in an interrupted recoverable state.",
      blockAutomaticRecovery: false,
    };
  }

  if (input.hasPendingRunAttempt) {
    return {
      eligible: false,
      code: RECOVERY_ACTIVE_ATTEMPT_CODE,
      message: "A pending run attempt already exists for this run.",
      blockAutomaticRecovery: false,
    };
  }

  const latestCheckpoint = await input.checkpoints.findLatestByRun(
    input.run.workspaceId,
    input.run.id,
  );
  if (latestCheckpoint === null) {
    return {
      eligible: false,
      code: RECOVERY_NOT_CHECKPOINTED_CODE,
      message: "No durable checkpoint exists; automatic recovery is not safe.",
      blockAutomaticRecovery: true,
    };
  }

  const blocking = await input.operationJournal.findBlockingOperationsForRun(
    input.run.id,
  );
  for (const entry of blocking) {
    if (!isSideEffectSafeToAutoReplay(entry.idempotencyClass, entry.status)) {
      return {
        eligible: false,
        code: RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
        message:
          "Recovery is blocked because an external operation may have succeeded without a committed result.",
        blockAutomaticRecovery: true,
      };
    }
  }

  return { eligible: true };
}

export function effectiveAutomaticRecoveryEnabled(input: {
  readonly agentAutomaticRecoveryEnabled: boolean;
  readonly eligibility: RecoveryEligibilityResult;
}): boolean {
  if (!input.agentAutomaticRecoveryEnabled) {
    return false;
  }
  return input.eligibility.eligible;
}

export function buildBlockedRecoveryMetadata(
  current: RunRecoveryMetadataV1 | undefined,
  block: {
    readonly code: string;
    readonly message: string;
    readonly at: string;
  },
): RunRecoveryMetadataV1 {
  return {
    version: "1",
    recoveryAttemptCount: current?.recoveryAttemptCount ?? 0,
    automaticRecoveryEnabled: current?.automaticRecoveryEnabled ?? false,
    lastRecoveryAt: current?.lastRecoveryAt,
    blocked: block,
  };
}

export type { RunId, WorkspaceId };
