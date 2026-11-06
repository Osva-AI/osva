import type { RunCheckpointRecordV1, RunId } from "@osva-ai/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";
import { RunNotFoundError } from "./errors.js";
import type { RunCheckpointRepository } from "./ports/run-checkpoint-repository.js";
import {
  DEFAULT_RUN_CHECKPOINT_LIST_LIMIT,
  MAX_RUN_CHECKPOINT_LIST_LIMIT,
} from "./ports/run-checkpoint-repository.js";
import type { RunOperationJournalRepository } from "./ports/run-operation-journal-repository.js";
import type { RunRepository } from "./ports/run-repository.js";
import { assessRunRecoveryEligibility } from "./run-recovery-eligibility.js";
import { DomainInvariantError } from "./errors.js";

const RUN_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.run };

export interface RunRecoveryApplicationDependencies {
  readonly runs: RunRepository;
  readonly checkpoints: RunCheckpointRepository;
  readonly operationJournal: RunOperationJournalRepository;
}

export interface RunCheckpointSummary {
  readonly id: string;
  readonly sequence: number;
  readonly runAttemptId: RunCheckpointRecordV1["runAttemptId"];
  readonly executionGeneration: number;
  readonly envelopeVersion: RunCheckpointRecordV1["envelopeVersion"];
  readonly cursorPhase: RunCheckpointRecordV1["cursor"]["phase"];
  readonly checkpointSequence: number;
  readonly createdAt: string;
}

export interface RunRecoveryStatus {
  readonly runId: RunId;
  readonly runStatus: import("./run.js").Run["status"];
  readonly eligible: boolean;
  readonly ineligibleCode?: string;
  readonly ineligibleMessage?: string;
  readonly recovery?: import("@osva-ai/contracts").RunRecoveryMetadataV1;
  readonly latestCheckpoint?: RunCheckpointSummary;
  readonly blockedOperations: ReadonlyArray<{
    readonly operationKey: string;
    readonly status: "PENDING" | "UNCERTAIN" | "FAILED" | "COMMITTED";
    readonly idempotencyClass: import("@osva-ai/contracts").RunOperationIdempotencyClass;
    readonly bindingName: string;
    readonly toolVersionId: string;
  }>;
}

export class ListRunCheckpoints {
  constructor(private readonly deps: RunRecoveryApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    runId: RunId,
    limit = DEFAULT_RUN_CHECKPOINT_LIST_LIMIT,
  ): Promise<readonly RunCheckpointSummary[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      RUN_RESOURCE,
    );
    assertCheckpointListLimit(limit);
    const workspaceId = controlPlaneWorkspaceId(scope);
    const run = await this.deps.runs.findRunByWorkspaceAndId(
      workspaceId,
      runId,
    );
    if (run === null) {
      throw new RunNotFoundError(runId);
    }

    const page = await this.deps.checkpoints.list({
      workspaceId,
      runId,
      limit,
    });
    return page.checkpoints.map(toCheckpointSummary);
  }
}

export class GetRunRecoveryStatus {
  constructor(private readonly deps: RunRecoveryApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    runId: RunId,
  ): Promise<RunRecoveryStatus> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const run = await this.deps.runs.findRunByWorkspaceAndId(
      workspaceId,
      runId,
    );
    if (run === null) {
      throw new RunNotFoundError(runId);
    }

    const attempts = await this.deps.runs.listRunAttempts(runId);
    const hasPendingRunAttempt = attempts.some(
      (attempt) => attempt.status === "PENDING" || attempt.status === "RUNNING",
    );

    const eligibility = await assessRunRecoveryEligibility({
      run,
      checkpoints: this.deps.checkpoints,
      operationJournal: this.deps.operationJournal,
      hasPendingRunAttempt,
    });

    const latest = await this.deps.checkpoints.findLatestByRun(
      workspaceId,
      runId,
    );
    const blocking =
      await this.deps.operationJournal.findBlockingOperationsForRun(runId);

    return {
      runId,
      runStatus: run.status,
      eligible: eligibility.eligible,
      ...(eligibility.eligible
        ? {}
        : {
            ineligibleCode: eligibility.code,
            ineligibleMessage: eligibility.message,
          }),
      ...(run.recoveryMetadata !== undefined
        ? { recovery: run.recoveryMetadata }
        : {}),
      ...(latest !== null
        ? { latestCheckpoint: toCheckpointSummary(latest) }
        : {}),
      blockedOperations: blocking.map((entry) => ({
        operationKey: entry.operationKey,
        status: entry.status,
        idempotencyClass: entry.idempotencyClass,
        bindingName: entry.bindingName,
        toolVersionId: entry.toolVersionId,
      })),
    };
  }
}

export interface RunRecoveryApplication {
  readonly listRunCheckpoints: ListRunCheckpoints;
  readonly getRunRecoveryStatus: GetRunRecoveryStatus;
}

export function createRunRecoveryApplication(
  deps: RunRecoveryApplicationDependencies,
): RunRecoveryApplication {
  return {
    listRunCheckpoints: new ListRunCheckpoints(deps),
    getRunRecoveryStatus: new GetRunRecoveryStatus(deps),
  };
}

function toCheckpointSummary(
  checkpoint: RunCheckpointRecordV1,
): RunCheckpointSummary {
  return {
    id: checkpoint.id,
    sequence: checkpoint.sequence,
    runAttemptId: checkpoint.runAttemptId,
    executionGeneration: checkpoint.executionGeneration,
    envelopeVersion: checkpoint.envelopeVersion,
    cursorPhase: checkpoint.cursor.phase,
    checkpointSequence: checkpoint.cursor.checkpointSequence,
    createdAt: checkpoint.createdAt,
  };
}

function assertCheckpointListLimit(limit: number): void {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_RUN_CHECKPOINT_LIST_LIMIT
  ) {
    throw new DomainInvariantError(
      `Checkpoint list limit must be an integer between 1 and ${String(MAX_RUN_CHECKPOINT_LIST_LIMIT)}.`,
    );
  }
}
