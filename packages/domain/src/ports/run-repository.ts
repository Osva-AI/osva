import type {
  AgentId,
  AgentVersionId,
  RunAttemptId,
  RunAttemptState,
  RunId,
  RunState,
} from "@osva/contracts";

import type { Run } from "../run.js";
import type { RunAttempt } from "../run-attempt.js";
import type { RunStep } from "../run-step.js";

export const DEFAULT_RUN_LIST_LIMIT = 50;
export const MAX_RUN_LIST_LIMIT = 100;

export interface RunListCursor {
  readonly createdAt: Date;
  readonly id: RunId;
}

export interface ListRunsQuery {
  readonly limit: number;
  readonly cursor?: RunListCursor;
  readonly agentId?: AgentId;
  readonly agentVersionId?: AgentVersionId;
  readonly status?: RunState;
}

export interface ListRunsResult {
  readonly runs: readonly Run[];
  readonly nextCursor?: RunListCursor;
}

export interface RunLifecycleTransitionResult {
  readonly run: Run;
  readonly runAttempt: RunAttempt;
}

export interface RunRepository {
  createRunWithInitialAttempt(run: Run, attempt: RunAttempt): Promise<void>;
  saveRun(run: Run): Promise<void>;
  findRunById(id: RunId): Promise<Run | null>;
  listRuns(query: ListRunsQuery): Promise<ListRunsResult>;
  saveRunAttempt(attempt: RunAttempt): Promise<void>;
  findRunAttemptById(id: RunAttemptId): Promise<RunAttempt | null>;
  listRunAttempts(runId: RunId): Promise<readonly RunAttempt[]>;
  saveRunStep(step: RunStep): Promise<void>;
  transitionRun(expectedStatus: RunState, next: Run): Promise<Run>;
  transitionRunAttempt(
    expectedStatus: RunAttemptState,
    next: RunAttempt,
  ): Promise<RunAttempt>;
  transitionRunAndAttempt(
    expectedRunStatus: RunState,
    nextRun: Run,
    expectedAttemptStatus: RunAttemptState,
    nextAttempt: RunAttempt,
  ): Promise<RunLifecycleTransitionResult>;
}
