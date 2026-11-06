import type { RunAttemptId, RunId, ToolVersionId, WorkspaceId } from "./ids.js";
import type {
  RunOperationIdempotencyClass,
  RunOperationJournalEntryV1,
} from "./run-operation-journal.js";
import type { JsonValue } from "./json-value.js";

export interface RecordRunOperationPendingInput {
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

export interface CommitRunOperationResultInput {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly operationKey: string;
  readonly committedResult: JsonValue;
}

export interface RunOperationJournalPort {
  recordPending(
    input: RecordRunOperationPendingInput,
  ): Promise<RunOperationJournalEntryV1>;
  commitResult(
    input: CommitRunOperationResultInput,
  ): Promise<RunOperationJournalEntryV1 | null>;
  markUncertain(input: {
    readonly workspaceId: WorkspaceId;
    readonly runId: RunId;
    readonly operationKey: string;
  }): Promise<RunOperationJournalEntryV1 | null>;
  markFailed(input: {
    readonly workspaceId: WorkspaceId;
    readonly runId: RunId;
    readonly operationKey: string;
  }): Promise<RunOperationJournalEntryV1 | null>;
  findByRunAndOperationKey(
    workspaceId: WorkspaceId,
    runId: RunId,
    operationKey: string,
  ): Promise<RunOperationJournalEntryV1 | null>;
}
