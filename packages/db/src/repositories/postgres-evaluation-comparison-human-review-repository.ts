import { and, asc, desc, eq } from "drizzle-orm";
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

import type { Database } from "../database.js";
import {
  postgresConstraintName,
  postgresErrorCode,
  POSTGRES_UNIQUE_VIOLATION,
} from "../postgres-errors.js";
import {
  humanReviewRevisionFromRow,
  humanReviewRevisionToRow,
} from "../mappers/evaluation-comparison-human-review-mapper.js";
import { evaluationComparisonHumanReviewRevisions } from "../schema/evaluation-comparisons.js";

export class PostgresEvaluationComparisonHumanReviewRepository implements EvaluationComparisonHumanReviewRepository {
  constructor(private readonly database: Database) {}

  async appendReviewRevision(
    revision: EvaluationComparisonHumanReviewRevision,
  ): Promise<void> {
    try {
      await this.database.db
        .insert(evaluationComparisonHumanReviewRevisions)
        .values(humanReviewRevisionToRow(revision));
    } catch (error) {
      if (isSupersedesRevisionUniqueViolation(error)) {
        throw new EvaluationComparisonRequestError(
          "human_review_supersession_conflict",
        );
      }
      throw error;
    }
  }

  async listReviewsByComparison(
    comparisonId: EvaluationComparisonId,
  ): Promise<readonly EvaluationComparisonHumanReviewRevision[]> {
    const rows = await this.database.db
      .select()
      .from(evaluationComparisonHumanReviewRevisions)
      .where(
        eq(evaluationComparisonHumanReviewRevisions.comparisonId, comparisonId),
      )
      .orderBy(
        asc(evaluationComparisonHumanReviewRevisions.evaluationCaseId),
        desc(evaluationComparisonHumanReviewRevisions.createdAt),
        desc(evaluationComparisonHumanReviewRevisions.id),
      );
    return rows.map(humanReviewRevisionFromRow);
  }

  async findEffectiveReviewForCase(
    comparisonId: EvaluationComparisonId,
    evaluationCaseId: EvaluationCaseId,
    reviewerUserId: UserId,
  ): Promise<EvaluationComparisonHumanReviewRevision | null> {
    const rows = await this.database.db
      .select()
      .from(evaluationComparisonHumanReviewRevisions)
      .where(
        and(
          eq(
            evaluationComparisonHumanReviewRevisions.comparisonId,
            comparisonId,
          ),
          eq(
            evaluationComparisonHumanReviewRevisions.evaluationCaseId,
            evaluationCaseId,
          ),
          eq(
            evaluationComparisonHumanReviewRevisions.reviewerUserId,
            reviewerUserId,
          ),
        ),
      );
    return selectEffectiveReviewerRevision(
      rows.map(humanReviewRevisionFromRow),
    );
  }

  async findReviewRevisionByWorkspaceAndId(
    workspaceId: WorkspaceId,
    revisionId: EvaluationComparisonHumanReviewRevisionId,
  ): Promise<EvaluationComparisonHumanReviewRevision | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationComparisonHumanReviewRevisions)
      .where(
        and(
          eq(evaluationComparisonHumanReviewRevisions.id, revisionId),
          eq(evaluationComparisonHumanReviewRevisions.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return row === undefined ? null : humanReviewRevisionFromRow(row);
  }
}

function selectEffectiveReviewerRevision(
  revisions: readonly EvaluationComparisonHumanReviewRevision[],
): EvaluationComparisonHumanReviewRevision | null {
  if (revisions.length === 0) {
    return null;
  }
  const superseded = new Set(
    revisions
      .map((revision) => revision.supersedesRevisionId)
      .filter((id): id is NonNullable<typeof id> => id !== undefined),
  );
  const effective = revisions
    .filter((revision) => !superseded.has(revision.id))
    .sort((a, b) => {
      const byTime = b.createdAt.getTime() - a.createdAt.getTime();
      return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
    });
  return effective[0] ?? null;
}

function isSupersedesRevisionUniqueViolation(error: unknown): boolean {
  return (
    postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
    postgresConstraintName(error) ===
      "evaluation_comparison_human_review_supersedes_unique"
  );
}
