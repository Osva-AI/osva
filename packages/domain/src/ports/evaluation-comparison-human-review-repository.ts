import type {
  EvaluationCaseId,
  EvaluationComparisonHumanReviewRevisionId,
  EvaluationComparisonId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";

export interface EvaluationComparisonHumanReviewRevision {
  readonly id: EvaluationComparisonHumanReviewRevisionId;
  readonly workspaceId: WorkspaceId;
  readonly comparisonId: EvaluationComparisonId;
  readonly evaluationCaseId: EvaluationCaseId;
  readonly reviewerUserId: UserId;
  readonly decision: import("@osva-ai/contracts").EvaluationComparisonHumanDecision;
  readonly rationale?: string;
  readonly evidenceReference: string;
  readonly supersedesRevisionId?: EvaluationComparisonHumanReviewRevisionId;
  readonly createdAt: Date;
}

export interface EvaluationComparisonHumanReviewRepository {
  appendReviewRevision(
    revision: EvaluationComparisonHumanReviewRevision,
  ): Promise<void>;
  listReviewsByComparison(
    comparisonId: EvaluationComparisonId,
  ): Promise<readonly EvaluationComparisonHumanReviewRevision[]>;
  findEffectiveReviewForCase(
    comparisonId: EvaluationComparisonId,
    evaluationCaseId: EvaluationCaseId,
    reviewerUserId: UserId,
  ): Promise<EvaluationComparisonHumanReviewRevision | null>;
  findReviewRevisionByWorkspaceAndId(
    workspaceId: WorkspaceId,
    revisionId: EvaluationComparisonHumanReviewRevisionId,
  ): Promise<EvaluationComparisonHumanReviewRevision | null>;
}
