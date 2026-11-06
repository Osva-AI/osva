import type {
  CommitRunCheckpointCommand,
  CommitRunCheckpointResult,
  RunCheckpointRecordV1,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";

export const DEFAULT_RUN_CHECKPOINT_LIST_LIMIT = 20;
export const MAX_RUN_CHECKPOINT_LIST_LIMIT = 100;

export interface ListRunCheckpointsQuery {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly limit: number;
}

export interface ListRunCheckpointsResult {
  readonly checkpoints: readonly RunCheckpointRecordV1[];
}

export interface RunCheckpointRepository {
  commit(
    command: CommitRunCheckpointCommand,
  ): Promise<CommitRunCheckpointResult>;
  findLatestByRun(
    workspaceId: WorkspaceId,
    runId: RunId,
  ): Promise<RunCheckpointRecordV1 | null>;
  findByRunAndSequence(
    workspaceId: WorkspaceId,
    runId: RunId,
    sequence: number,
  ): Promise<RunCheckpointRecordV1 | null>;
  list(query: ListRunCheckpointsQuery): Promise<ListRunCheckpointsResult>;
  findByIdempotencyKey(
    workspaceId: WorkspaceId,
    runId: RunId,
    idempotencyKey: string,
  ): Promise<RunCheckpointRecordV1 | null>;
  countByRun(runId: RunId): Promise<number>;
  deleteOldestBeyondLimit(runId: RunId, keep: number): Promise<void>;
}

export interface RunCheckpointRepositoryLookup {
  readonly checkpoints: RunCheckpointRepository;
}
