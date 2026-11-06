import type {
  CommitRunCheckpointCommand,
  CommitRunCheckpointResult,
  RunCheckpointRecordV1,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { RUN_CHECKPOINT_ENVELOPE_VERSION } from "@osva-ai/contracts";
import {
  digestCheckpointPayload,
  digestRunCheckpointBindings,
  validateDeclarativeCheckpointState,
  type ListRunCheckpointsQuery,
  type ListRunCheckpointsResult,
  type RunCheckpointRepository,
} from "@osva/domain";

export class MemoryRunCheckpointRepository implements RunCheckpointRepository {
  private readonly checkpoints: RunCheckpointRecordV1[] = [];
  private readonly idempotencyIndex = new Map<string, RunCheckpointRecordV1>();
  private readonly attempts = new Map<
    string,
    { owner: string; generation: number; status: string }
  >();

  trackRunningAttempt(input: {
    readonly runAttemptId: string;
    readonly owner: string;
    readonly generation: number;
  }): void {
    this.attempts.set(input.runAttemptId, {
      owner: input.owner,
      generation: input.generation,
      status: "RUNNING",
    });
  }

  clearAttempt(runAttemptId: string): void {
    this.attempts.delete(runAttemptId);
  }

  async commit(
    command: CommitRunCheckpointCommand,
  ): Promise<CommitRunCheckpointResult> {
    if (!validateDeclarativeCheckpointState(command.state)) {
      return { outcome: "invalid_state" };
    }

    const duplicate = await this.findByIdempotencyKey(
      command.workspaceId,
      command.runId,
      command.idempotencyKey,
    );
    if (duplicate !== null) {
      return { outcome: "duplicate", checkpoint: duplicate };
    }

    const attempt = this.attempts.get(command.runAttemptId);
    if (
      attempt === undefined ||
      attempt.status !== "RUNNING" ||
      attempt.generation !== command.executionGeneration ||
      attempt.owner !== command.executionOwner
    ) {
      return { outcome: "stale_generation" };
    }

    const bindingDigest = digestRunCheckpointBindings(command.bindingIdentity);
    const payloadDigest = digestCheckpointPayload(command.state);
    const sequence =
      (this.checkpoints
        .filter((row) => row.runId === command.runId)
        .map((row) => row.sequence)
        .reduce((max, value) => Math.max(max, value), 0) ?? 0) + 1;

    const record: RunCheckpointRecordV1 = {
      id: `checkpoint-${command.runId}-${String(sequence)}`,
      workspaceId: command.workspaceId,
      runId: command.runId,
      sequence,
      runAttemptId: command.runAttemptId,
      executionGeneration: command.executionGeneration,
      runtimeKind: command.runtimeKind,
      envelopeVersion: RUN_CHECKPOINT_ENVELOPE_VERSION,
      stateSchemaVersion: command.state.schemaVersion,
      bindingIdentity: command.bindingIdentity,
      bindingDigest,
      cursor: {
        ...command.cursor,
        checkpointSequence: sequence,
      },
      state: command.state,
      payloadDigest,
      createdAt: new Date().toISOString(),
    };

    this.checkpoints.push(record);
    this.idempotencyIndex.set(
      `${command.workspaceId}:${command.runId}:${command.idempotencyKey}`,
      record,
    );
    return { outcome: "committed", checkpoint: record };
  }

  async findLatestByRun(
    workspaceId: WorkspaceId,
    runId: RunId,
  ): Promise<RunCheckpointRecordV1 | null> {
    const rows = this.checkpoints
      .filter((row) => row.workspaceId === workspaceId && row.runId === runId)
      .sort((left, right) => right.sequence - left.sequence);
    return rows[0] ?? null;
  }

  async findByRunAndSequence(
    workspaceId: WorkspaceId,
    runId: RunId,
    sequence: number,
  ): Promise<RunCheckpointRecordV1 | null> {
    return (
      this.checkpoints.find(
        (row) =>
          row.workspaceId === workspaceId &&
          row.runId === runId &&
          row.sequence === sequence,
      ) ?? null
    );
  }

  async list(
    query: ListRunCheckpointsQuery,
  ): Promise<ListRunCheckpointsResult> {
    const rows = this.checkpoints
      .filter(
        (row) =>
          row.workspaceId === query.workspaceId && row.runId === query.runId,
      )
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, query.limit);
    return { checkpoints: rows };
  }

  async findByIdempotencyKey(
    workspaceId: WorkspaceId,
    runId: RunId,
    idempotencyKey: string,
  ): Promise<RunCheckpointRecordV1 | null> {
    return (
      this.idempotencyIndex.get(`${workspaceId}:${runId}:${idempotencyKey}`) ??
      null
    );
  }

  async countByRun(runId: RunId): Promise<number> {
    return this.checkpoints.filter((row) => row.runId === runId).length;
  }

  async deleteOldestBeyondLimit(_runId: RunId, _keep: number): Promise<void> {
    void _runId;
    void _keep;
  }
}
