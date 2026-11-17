import type {
  EvaluationCaseId,
  EvaluationComparisonHumanReviewRevisionId,
  EvaluationComparisonId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  EvaluationComparisonRequestError,
  type EvaluationComparisonHumanReviewRepository,
  type EvaluationComparisonHumanReviewRevision,
} from "@osva/domain";

export class MemoryEvaluationComparisonHumanReviewRepository implements EvaluationComparisonHumanReviewRepository {
  private readonly revisions: EvaluationComparisonHumanReviewRevision[] = [];

  async appendReviewRevision(
    revision: EvaluationComparisonHumanReviewRevision,
  ): Promise<void> {
    if (revision.supersedesRevisionId !== undefined) {
      const conflicting = this.revisions.some(
        (existing) =>
          existing.supersedesRevisionId === revision.supersedesRevisionId,
      );
      if (conflicting) {
        throw new EvaluationComparisonRequestError(
          "human_review_supersession_conflict",
        );
      }
    }
    this.revisions.push(revision);
  }

  async listReviewsByComparison(
    comparisonId: EvaluationComparisonId,
  ): Promise<readonly EvaluationComparisonHumanReviewRevision[]> {
    return this.revisions.filter(
      (revision) => revision.comparisonId === comparisonId,
    );
  }

  async findEffectiveReviewForCase(
    comparisonId: EvaluationComparisonId,
    evaluationCaseId: EvaluationCaseId,
    reviewerUserId: UserId,
  ): Promise<EvaluationComparisonHumanReviewRevision | null> {
    const forReviewer = this.revisions.filter(
      (revision) =>
        revision.comparisonId === comparisonId &&
        revision.evaluationCaseId === evaluationCaseId &&
        revision.reviewerUserId === reviewerUserId,
    );
    const superseded = new Set(
      forReviewer
        .map((revision) => revision.supersedesRevisionId)
        .filter((id): id is NonNullable<typeof id> => id !== undefined),
    );
    const effective = forReviewer
      .filter((revision) => !superseded.has(revision.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return effective[0] ?? null;
  }

  async findReviewRevisionByWorkspaceAndId(
    workspaceId: WorkspaceId,
    revisionId: EvaluationComparisonHumanReviewRevisionId,
  ): Promise<EvaluationComparisonHumanReviewRevision | null> {
    const match = this.revisions.find(
      (revision) =>
        revision.id === revisionId && revision.workspaceId === workspaceId,
    );
    return match ?? null;
  }
}
