import type {
  EvaluationCaseId,
  EvaluationComparisonId,
  EvaluationComparisonPairwiseJudgmentPosition,
  EvaluationComparisonPairwiseTaskId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { EvaluationComparisonPairwiseTask } from "../evaluation-comparison-pairwise-task.js";

export interface ClaimComparisonPairwiseTaskLeaseCommand {
  readonly taskId: EvaluationComparisonPairwiseTaskId;
  readonly workspaceId: WorkspaceId;
  readonly owner: string;
  readonly generation: number;
  readonly leaseExpiresAt: Date;
  readonly now: Date;
}

export interface EvaluationComparisonPairwiseTaskRepository {
  savePairwiseTaskIfAbsent(
    task: EvaluationComparisonPairwiseTask,
  ): Promise<"created" | "existing">;
  findPairwiseTask(
    comparisonId: EvaluationComparisonId,
    evaluationCaseId: EvaluationCaseId,
    judgmentPosition: EvaluationComparisonPairwiseJudgmentPosition,
  ): Promise<EvaluationComparisonPairwiseTask | null>;
  findPairwiseTaskById(
    id: EvaluationComparisonPairwiseTaskId,
  ): Promise<EvaluationComparisonPairwiseTask | null>;
  listPairwiseTasksForRecovery(
    limit: number,
    now: Date,
  ): Promise<readonly EvaluationComparisonPairwiseTask[]>;
  claimPairwiseTaskLease(
    command: ClaimComparisonPairwiseTaskLeaseCommand,
  ): Promise<EvaluationComparisonPairwiseTask | null>;
  savePairwiseTaskTerminal(
    task: EvaluationComparisonPairwiseTask,
  ): Promise<boolean>;
  appendPairwiseInvocationAttempt(command: {
    readonly taskId: EvaluationComparisonPairwiseTaskId;
    readonly workspaceId: WorkspaceId;
    readonly executionGeneration: number;
    readonly attempt: Readonly<Record<string, unknown>>;
  }): Promise<boolean>;
  countNonTerminalPairwiseTasksByComparison(
    comparisonId: EvaluationComparisonId,
  ): Promise<number>;
  listSucceededPairwiseTasksByComparison(
    comparisonId: EvaluationComparisonId,
  ): Promise<readonly EvaluationComparisonPairwiseTask[]>;
  listPairwiseTasksByComparison(
    workspaceId: WorkspaceId,
    comparisonId: EvaluationComparisonId,
  ): Promise<readonly EvaluationComparisonPairwiseTask[]>;
}
