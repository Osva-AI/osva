import type { RunAttemptId, RunId, ToolVersionId, WorkspaceId } from "./ids.js";
import type { JsonValue } from "./json-value.js";

export const RUN_OPERATION_JOURNAL_SCHEMA_VERSION = "1" as const;

export type RunOperationJournalSchemaVersion =
  typeof RUN_OPERATION_JOURNAL_SCHEMA_VERSION;

export const RUN_OPERATION_STATUSES = [
  "PENDING",
  "COMMITTED",
  "UNCERTAIN",
  "FAILED",
] as const;

export type RunOperationStatus = (typeof RUN_OPERATION_STATUSES)[number];

export const RUN_OPERATION_IDEMPOTENCY_CLASSES = [
  "PURE",
  "READ_ONLY",
  "IDEMPOTENT_WRITE",
  "RECONCILE",
  "UNKNOWN_WRITE",
] as const;

export type RunOperationIdempotencyClass =
  (typeof RUN_OPERATION_IDEMPOTENCY_CLASSES)[number];

export interface RunOperationJournalEntryV1 {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly executionGeneration: number;
  readonly operationKey: string;
  readonly toolVersionId: ToolVersionId;
  readonly bindingName: string;
  readonly inputFingerprint: string;
  readonly idempotencyClass: RunOperationIdempotencyClass;
  readonly status: RunOperationStatus;
  readonly committedResult?: JsonValue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE =
  "RECOVERY_BLOCKED_UNCERTAIN_OPERATION";
