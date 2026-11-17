import type { EvaluationComparisonId } from "@osva-ai/contracts";
import { EvaluationComparison } from "@osva/domain";

import type { evaluationComparisons } from "../schema/evaluation-comparisons.js";

type EvaluationComparisonRow = typeof evaluationComparisons.$inferSelect;

function sqlDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function optionalSqlDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : sqlDate(value);
}

export function evaluationComparisonToRow(
  comparison: EvaluationComparison,
): typeof evaluationComparisons.$inferInsert {
  return {
    id: comparison.id,
    workspaceId: comparison.workspaceId,
    baselineEvaluationRunId: comparison.baselineEvaluationRunId,
    candidateEvaluationRunId: comparison.candidateEvaluationRunId,
    evaluationSuiteVersionId: comparison.evaluationSuiteVersionId,
    status: comparison.status,
    policySnapshot: comparison.policySnapshot,
    pairwiseConfig: comparison.pairwiseConfig ?? null,
    deterministicSummary: comparison.deterministicSummary ?? null,
    pairwiseSummary: comparison.pairwiseSummary ?? null,
    regressionAssessment: comparison.regressionAssessment ?? null,
    promotion: comparison.promotion ?? null,
    costSummary: comparison.costSummary ?? null,
    pairwiseRubricIdentity: comparison.pairwiseRubricIdentity ?? null,
    createdAt: comparison.createdAt,
    updatedAt: comparison.updatedAt,
    completedAt: comparison.completedAt ?? null,
  };
}

export function evaluationComparisonFromSqlRow(
  row: Record<string, unknown>,
): EvaluationComparison {
  return evaluationComparisonFromRow({
    id: row.id,
    workspaceId: row.workspace_id,
    baselineEvaluationRunId: row.baseline_evaluation_run_id,
    candidateEvaluationRunId: row.candidate_evaluation_run_id,
    evaluationSuiteVersionId: row.evaluation_suite_version_id,
    status: row.status,
    policySnapshot: row.policy_snapshot,
    pairwiseConfig: row.pairwise_config,
    deterministicSummary: row.deterministic_summary,
    pairwiseSummary: row.pairwise_summary,
    regressionAssessment: row.regression_assessment,
    promotion: row.promotion,
    costSummary: row.cost_summary,
    pairwiseRubricIdentity: row.pairwise_rubric_identity,
    createdAt: sqlDate(row.created_at),
    updatedAt: sqlDate(row.updated_at),
    completedAt: optionalSqlDate(row.completed_at),
  } as EvaluationComparisonRow);
}

export function evaluationComparisonFromRow(
  row: EvaluationComparisonRow,
): EvaluationComparison {
  return EvaluationComparison.restore({
    id: row.id as EvaluationComparisonId,
    workspaceId: row.workspaceId as never,
    baselineEvaluationRunId: row.baselineEvaluationRunId as never,
    candidateEvaluationRunId: row.candidateEvaluationRunId as never,
    evaluationSuiteVersionId: row.evaluationSuiteVersionId as never,
    status: row.status as never,
    policySnapshot: row.policySnapshot,
    pairwiseConfig: row.pairwiseConfig ?? undefined,
    deterministicSummary: row.deterministicSummary ?? undefined,
    pairwiseSummary: row.pairwiseSummary ?? undefined,
    regressionAssessment: row.regressionAssessment ?? undefined,
    promotion: row.promotion ?? undefined,
    costSummary: row.costSummary ?? undefined,
    pairwiseRubricIdentity: row.pairwiseRubricIdentity ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? undefined,
  });
}
