import type {
  EvaluationComparisonId,
  EvaluationComparisonState,
  EvaluationRunId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { EvaluationComparison } from "../evaluation-comparison.js";

export const DEFAULT_EVALUATION_COMPARISON_LIST_LIMIT = 50;
export const MAX_EVALUATION_COMPARISON_LIST_LIMIT = 100;

export interface ListEvaluationComparisonsQuery {
  readonly workspaceId: WorkspaceId;
  readonly limit: number;
  readonly cursor?: {
    readonly createdAt: Date;
    readonly id: EvaluationComparisonId;
  };
  readonly status?: EvaluationComparisonState;
  readonly evaluationSuiteVersionId?: EvaluationSuiteVersionId;
  readonly baselineEvaluationRunId?: EvaluationRunId;
  readonly candidateEvaluationRunId?: EvaluationRunId;
}

export interface ListEvaluationComparisonsResult {
  readonly comparisons: readonly EvaluationComparison[];
  readonly nextCursor?: {
    readonly createdAt: Date;
    readonly id: EvaluationComparisonId;
  };
}

export interface EvaluationComparisonRepository {
  saveComparisonIfAbsent(
    comparison: EvaluationComparison,
  ): Promise<"created" | "existing">;
  saveComparison(comparison: EvaluationComparison): Promise<boolean>;
  findComparisonById(
    id: EvaluationComparisonId,
  ): Promise<EvaluationComparison | null>;
  findComparisonByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: EvaluationComparisonId,
  ): Promise<EvaluationComparison | null>;
  findByRunPair(
    baselineEvaluationRunId: EvaluationRunId,
    candidateEvaluationRunId: EvaluationRunId,
  ): Promise<EvaluationComparison | null>;
  listComparisonsByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly EvaluationComparison[]>;
  listComparisons(
    query: ListEvaluationComparisonsQuery,
  ): Promise<ListEvaluationComparisonsResult>;
  listComparisonsPendingReconciliation(
    limit: number,
  ): Promise<readonly EvaluationComparison[]>;
}
