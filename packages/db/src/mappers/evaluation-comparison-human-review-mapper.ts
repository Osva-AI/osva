import type { EvaluationComparisonHumanReviewRevisionId } from "@osva-ai/contracts";
import type { EvaluationComparisonHumanReviewRevision } from "@osva/domain";

import type { evaluationComparisonHumanReviewRevisions } from "../schema/evaluation-comparisons.js";

export function humanReviewRevisionToRow(
  revision: EvaluationComparisonHumanReviewRevision,
): typeof evaluationComparisonHumanReviewRevisions.$inferInsert {
  return {
    id: revision.id,
    workspaceId: revision.workspaceId,
    comparisonId: revision.comparisonId,
    evaluationCaseId: revision.evaluationCaseId,
    reviewerUserId: revision.reviewerUserId,
    decision: revision.decision,
    rationale: revision.rationale ?? null,
    evidenceReference: revision.evidenceReference,
    supersedesRevisionId: revision.supersedesRevisionId ?? null,
    createdAt: revision.createdAt,
  };
}

export function humanReviewRevisionFromRow(
  row: typeof evaluationComparisonHumanReviewRevisions.$inferSelect,
): EvaluationComparisonHumanReviewRevision {
  return {
    id: row.id as EvaluationComparisonHumanReviewRevisionId,
    workspaceId: row.workspaceId as never,
    comparisonId: row.comparisonId as never,
    evaluationCaseId: row.evaluationCaseId as never,
    reviewerUserId: row.reviewerUserId as never,
    decision: row.decision as never,
    rationale: row.rationale ?? undefined,
    evidenceReference: row.evidenceReference,
    supersedesRevisionId:
      row.supersedesRevisionId === null
        ? undefined
        : (row.supersedesRevisionId as EvaluationComparisonHumanReviewRevisionId),
    createdAt: row.createdAt,
  };
}
