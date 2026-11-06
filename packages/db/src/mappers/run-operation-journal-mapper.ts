import type { RunOperationJournalEntryV1 } from "@osva-ai/contracts";

import type { runOperationJournal } from "../schema/run-operation-journal.js";
import { toDomainDate } from "./timestamps.js";

type RunOperationJournalRow = typeof runOperationJournal.$inferSelect;

export function runOperationJournalFromRow(
  row: RunOperationJournalRow,
): RunOperationJournalEntryV1 {
  return {
    id: row.id,
    workspaceId: row.workspaceId as RunOperationJournalEntryV1["workspaceId"],
    runId: row.runId as RunOperationJournalEntryV1["runId"],
    runAttemptId:
      row.runAttemptId as RunOperationJournalEntryV1["runAttemptId"],
    executionGeneration: row.executionGeneration,
    operationKey: row.operationKey,
    toolVersionId:
      row.toolVersionId as RunOperationJournalEntryV1["toolVersionId"],
    bindingName: row.bindingName,
    inputFingerprint: row.inputFingerprint,
    idempotencyClass:
      row.idempotencyClass as RunOperationJournalEntryV1["idempotencyClass"],
    status: row.status as RunOperationJournalEntryV1["status"],
    committedResult: row.committedResult ?? undefined,
    createdAt: toDomainDate(row.createdAt).toISOString(),
    updatedAt: toDomainDate(row.updatedAt).toISOString(),
  };
}
