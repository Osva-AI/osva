import type {
  RunAttemptId,
  RunId,
  RunOperationIdempotencyClass,
  RunOperationJournalEntryV1,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { JsonValue } from "@osva-ai/contracts";

export interface RecordRunOperationPendingCommand {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly executionGeneration: number;
  readonly operationKey: string;
  readonly toolVersionId: ToolVersionId;
  readonly bindingName: string;
  readonly inputFingerprint: string;
  readonly idempotencyClass: RunOperationIdempotencyClass;
}

export interface CommitRunOperationResultCommand {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly operationKey: string;
  readonly committedResult: JsonValue;
}

export interface MarkRunOperationUncertainCommand {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly operationKey: string;
}

export interface MarkRunOperationFailedCommand {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly operationKey: string;
}

export interface RunOperationJournalRepository {
  recordPending(
    command: RecordRunOperationPendingCommand,
  ): Promise<RunOperationJournalEntryV1>;
  commitResult(
    command: CommitRunOperationResultCommand,
  ): Promise<RunOperationJournalEntryV1 | null>;
  markUncertain(
    command: MarkRunOperationUncertainCommand,
  ): Promise<RunOperationJournalEntryV1 | null>;
  markFailed(
    command: MarkRunOperationFailedCommand,
  ): Promise<RunOperationJournalEntryV1 | null>;
  findByRunAndOperationKey(
    workspaceId: WorkspaceId,
    runId: RunId,
    operationKey: string,
  ): Promise<RunOperationJournalEntryV1 | null>;
  findBlockingOperationsForRun(
    runId: RunId,
  ): Promise<readonly RunOperationJournalEntryV1[]>;
  listByRun(runId: RunId): Promise<readonly RunOperationJournalEntryV1[]>;
}
