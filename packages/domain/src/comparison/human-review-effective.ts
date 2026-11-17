import type { EvaluationCaseId } from "@osva-ai/contracts";

import type { EvaluationComparisonHumanReviewRevision } from "../ports/evaluation-comparison-human-review-repository.js";

export function filterNonSupersededHumanReviews(
  revisions: readonly EvaluationComparisonHumanReviewRevision[],
): readonly EvaluationComparisonHumanReviewRevision[] {
  const superseded = new Set(
    revisions
      .map((revision) => revision.supersedesRevisionId)
      .filter((id): id is NonNullable<typeof id> => id !== undefined),
  );
  return revisions.filter((revision) => !superseded.has(revision.id));
}

/**
 * Returns a single consensus human decision per case when effective reviewers
 * agree. Omits cases with no reviews or conflicting reviewer decisions.
 */
export function consensusHumanDecisionByCase(
  revisions: readonly EvaluationComparisonHumanReviewRevision[],
): ReadonlyMap<EvaluationCaseId, EvaluationComparisonHumanReviewRevision> {
  const effective = filterNonSupersededHumanReviews(revisions);
  const byCase = new Map<
    EvaluationCaseId,
    EvaluationComparisonHumanReviewRevision[]
  >();
  for (const revision of effective) {
    const list = byCase.get(revision.evaluationCaseId) ?? [];
    list.push(revision);
    byCase.set(revision.evaluationCaseId, list);
  }

  const consensus = new Map<
    EvaluationCaseId,
    EvaluationComparisonHumanReviewRevision
  >();
  for (const [caseId, caseRevisions] of byCase) {
    const decisions = new Set(caseRevisions.map((r) => r.decision));
    if (decisions.size === 1) {
      const latest = caseRevisions.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];
      if (latest !== undefined) {
        consensus.set(caseId, latest);
      }
    }
  }
  return consensus;
}
