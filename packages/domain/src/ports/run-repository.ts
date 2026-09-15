import type {
  AgentId,
  AgentVersionId,
  RunAttemptId,
  RunAttemptState,
  RunId,
  RunState,
  RunStepId,
} from "@osva/contracts";

import type { Run } from "../run.js";
import type { RunAttempt } from "../run-attempt.js";
import type { RunStep, FinalizeRunStepProps } from "../run-step.js";

export const DEFAULT_RUN_LIST_LIMIT = 50;
export const MAX_RUN_LIST_LIMIT = 100;

export const DEFAULT_RUN_STEP_LIST_LIMIT = 50;
export const MAX_RUN_STEP_LIST_LIMIT = 100;

export interface RunListCursor {
  readonly createdAt: Date;
  readonly id: RunId;
}

export interface RunStepListCursor {
  readonly startedAt: Date;
  readonly id: RunStepId;
}

export interface ListRunsQuery {
  readonly limit: number;
  readonly cursor?: RunListCursor;
  readonly agentId?: AgentId;
  readonly agentVersionId?: AgentVersionId;
  readonly status?: RunState;
}

export interface ListRunStepsQuery {
  readonly runAttemptId: RunAttemptId;
  readonly limit: number;
  readonly cursor?: RunStepListCursor;
}

export interface ListRunsResult {
  readonly runs: readonly Run[];
  readonly nextCursor?: RunListCursor;
}

export interface ListRunStepsResult {
  readonly steps: readonly RunStep[];
  readonly nextCursor?: RunStepListCursor;
}

export interface RunAttemptUsageSummary {
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens: number;
  readonly estimatedCostUsdMicros: number | null;
  readonly pricedModelCalls: number;
  readonly unpricedModelCalls: number;
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
  insertRunningRunStep(step: RunStep): Promise<void>;
  finalizeRunStep(
    runStepId: RunStepId,
    finalize: FinalizeRunStepProps,
  ): Promise<RunStep>;
  findRunStepById(id: RunStepId): Promise<RunStep | null>;
  listRunSteps(query: ListRunStepsQuery): Promise<ListRunStepsResult>;
  aggregateRunAttemptUsage(
    runAttemptId: RunAttemptId,
  ): Promise<RunAttemptUsageSummary>;
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
