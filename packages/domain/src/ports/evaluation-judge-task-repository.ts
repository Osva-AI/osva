import type {
  EvaluationCaseId,
  EvaluationJudgeTaskId,
  EvaluationRunId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { EvaluationJudgeTask } from "../evaluation-judge-task.js";

export interface ClaimEvaluationJudgeTaskLeaseCommand {
  readonly taskId: EvaluationJudgeTaskId;
  readonly workspaceId: WorkspaceId;
  readonly owner: string;
  readonly generation: number;
  readonly leaseExpiresAt: Date;
  readonly now: Date;
}

export interface EvaluationJudgeTaskRepository {
  saveJudgeTaskIfAbsent(
    task: EvaluationJudgeTask,
  ): Promise<"created" | "existing">;
  findJudgeTaskByRunAndCase(
    evaluationRunId: EvaluationRunId,
    evaluationCaseId: EvaluationCaseId,
  ): Promise<EvaluationJudgeTask | null>;
  findJudgeTaskById(
    id: EvaluationJudgeTaskId,
  ): Promise<EvaluationJudgeTask | null>;
  listJudgeTasksForRecovery(
    limit: number,
    now: Date,
  ): Promise<readonly EvaluationJudgeTask[]>;
  claimJudgeTaskLease(
    command: ClaimEvaluationJudgeTaskLeaseCommand,
  ): Promise<EvaluationJudgeTask | null>;
  saveJudgeTaskTerminal(task: EvaluationJudgeTask): Promise<boolean>;
  appendJudgeInvocationAttempt(command: {
    readonly taskId: EvaluationJudgeTaskId;
    readonly workspaceId: WorkspaceId;
    readonly executionGeneration: number;
    readonly attempt: Readonly<Record<string, unknown>>;
  }): Promise<boolean>;
  countNonTerminalJudgeTasksByRun(
    evaluationRunId: EvaluationRunId,
  ): Promise<number>;
  listTerminalJudgeTasksMissingCaseResult(
    limit: number,
  ): Promise<readonly EvaluationJudgeTask[]>;
}
