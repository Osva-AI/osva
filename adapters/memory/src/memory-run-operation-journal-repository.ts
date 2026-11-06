import type { RunId, RunOperationJournalEntryV1 } from "@osva-ai/contracts";
import type {
  CommitRunOperationResultCommand,
  MarkRunOperationFailedCommand,
  MarkRunOperationUncertainCommand,
  RecordRunOperationPendingCommand,
  RunOperationJournalRepository,
} from "@osva/domain";
import { isSideEffectSafeToAutoReplay } from "@osva/domain";

export class MemoryRunOperationJournalRepository implements RunOperationJournalRepository {
  private readonly byRunOperationKey = new Map<
    string,
    RunOperationJournalEntryV1
  >();

  private key(runId: RunId, operationKey: string): string {
    return `${runId}:${operationKey}`;
  }

  async recordPending(
    command: RecordRunOperationPendingCommand,
  ): Promise<RunOperationJournalEntryV1> {
    const mapKey = this.key(command.runId, command.operationKey);
    const existing = this.byRunOperationKey.get(mapKey);
    if (existing !== undefined) {
      return existing;
    }

    const now = new Date().toISOString();
    const entry: RunOperationJournalEntryV1 = {
      id: `journal-${mapKey}`,
      workspaceId: command.workspaceId,
      runId: command.runId,
      runAttemptId: command.runAttemptId,
      executionGeneration: command.executionGeneration,
      operationKey: command.operationKey,
      toolVersionId: command.toolVersionId,
      bindingName: command.bindingName,
      inputFingerprint: command.inputFingerprint,
      idempotencyClass: command.idempotencyClass,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    };
    this.byRunOperationKey.set(mapKey, entry);
    return entry;
  }

  async commitResult(
    command: CommitRunOperationResultCommand,
  ): Promise<RunOperationJournalEntryV1 | null> {
    const mapKey = this.key(command.runId, command.operationKey);
    const existing = this.byRunOperationKey.get(mapKey);
    if (existing === undefined) {
      return null;
    }
    const updated: RunOperationJournalEntryV1 = {
      ...existing,
      status: "COMMITTED",
      committedResult: command.committedResult,
      updatedAt: new Date().toISOString(),
    };
    this.byRunOperationKey.set(mapKey, updated);
    return updated;
  }

  async markUncertain(
    command: MarkRunOperationUncertainCommand,
  ): Promise<RunOperationJournalEntryV1 | null> {
    return this.updateStatus(command, "UNCERTAIN");
  }

  async markFailed(
    command: MarkRunOperationFailedCommand,
  ): Promise<RunOperationJournalEntryV1 | null> {
    return this.updateStatus(command, "FAILED");
  }

  private updateStatus(
    command: MarkRunOperationUncertainCommand,
    status: RunOperationJournalEntryV1["status"],
  ): RunOperationJournalEntryV1 | null {
    const mapKey = this.key(command.runId, command.operationKey);
    const existing = this.byRunOperationKey.get(mapKey);
    if (existing === undefined) {
      return null;
    }
    const updated: RunOperationJournalEntryV1 = {
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.byRunOperationKey.set(mapKey, updated);
    return updated;
  }

  async findByRunAndOperationKey(
    workspaceId: RecordRunOperationPendingCommand["workspaceId"],
    runId: RunId,
    operationKey: string,
  ): Promise<RunOperationJournalEntryV1 | null> {
    const entry = this.byRunOperationKey.get(this.key(runId, operationKey));
    if (entry === undefined || entry.workspaceId !== workspaceId) {
      return null;
    }
    return entry;
  }

  async findBlockingOperationsForRun(runId: RunId) {
    return [...this.byRunOperationKey.values()].filter(
      (entry) =>
        entry.runId === runId &&
        !isSideEffectSafeToAutoReplay(entry.idempotencyClass, entry.status),
    );
  }

  async listByRun(runId: RunId) {
    return [...this.byRunOperationKey.values()].filter(
      (entry) => entry.runId === runId,
    );
  }
}
