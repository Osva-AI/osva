import type { RunOperationJournalPort } from "@osva-ai/contracts";
import type { RunOperationJournalRepository } from "@osva/domain";

export function createRunOperationJournalPort(
  repository: RunOperationJournalRepository,
): RunOperationJournalPort {
  return {
    recordPending: (input) => repository.recordPending(input),
    commitResult: (input) => repository.commitResult(input),
    markUncertain: (input) => repository.markUncertain(input),
    markFailed: (input) => repository.markFailed(input),
    findByRunAndOperationKey: (workspaceId, runId, operationKey) =>
      repository.findByRunAndOperationKey(workspaceId, runId, operationKey),
  };
}
