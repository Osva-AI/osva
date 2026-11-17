import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import type {
  EvaluationComparisonId,
  EvaluationRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type {
  EvaluationComparisonRepository,
  ListEvaluationComparisonsQuery,
  ListEvaluationComparisonsResult,
} from "@osva/domain";

import type { Database } from "../database.js";
import {
  evaluationComparisonFromRow,
  evaluationComparisonFromSqlRow,
  evaluationComparisonToRow,
} from "../mappers/evaluation-comparison-mapper.js";
import { evaluationComparisons } from "../schema/evaluation-comparisons.js";

export class PostgresEvaluationComparisonRepository implements EvaluationComparisonRepository {
  constructor(private readonly database: Database) {}

  async saveComparisonIfAbsent(
    comparison: import("@osva/domain").EvaluationComparison,
  ): Promise<"created" | "existing"> {
    await this.database.db
      .insert(evaluationComparisons)
      .values(evaluationComparisonToRow(comparison))
      .onConflictDoNothing({
        target: [
          evaluationComparisons.baselineEvaluationRunId,
          evaluationComparisons.candidateEvaluationRunId,
        ],
      });

    const stored = await this.findByRunPair(
      comparison.baselineEvaluationRunId,
      comparison.candidateEvaluationRunId,
    );
    return stored?.id === comparison.id ? "created" : "existing";
  }

  async saveComparison(
    comparison: import("@osva/domain").EvaluationComparison,
  ): Promise<boolean> {
    const rows = await this.database.db
      .update(evaluationComparisons)
      .set(evaluationComparisonToRow(comparison))
      .where(
        and(
          eq(evaluationComparisons.id, comparison.id),
          eq(evaluationComparisons.workspaceId, comparison.workspaceId),
        ),
      )
      .returning({ id: evaluationComparisons.id });
    return rows.length > 0;
  }

  async findComparisonById(
    id: EvaluationComparisonId,
  ): Promise<import("@osva/domain").EvaluationComparison | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationComparisons)
      .where(eq(evaluationComparisons.id, id))
      .limit(1);
    return row === undefined ? null : evaluationComparisonFromRow(row);
  }

  async findComparisonByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: EvaluationComparisonId,
  ): Promise<import("@osva/domain").EvaluationComparison | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationComparisons)
      .where(
        and(
          eq(evaluationComparisons.workspaceId, workspaceId),
          eq(evaluationComparisons.id, id),
        ),
      )
      .limit(1);
    return row === undefined ? null : evaluationComparisonFromRow(row);
  }

  async findByRunPair(
    baselineEvaluationRunId: EvaluationRunId,
    candidateEvaluationRunId: EvaluationRunId,
  ): Promise<import("@osva/domain").EvaluationComparison | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationComparisons)
      .where(
        and(
          eq(
            evaluationComparisons.baselineEvaluationRunId,
            baselineEvaluationRunId,
          ),
          eq(
            evaluationComparisons.candidateEvaluationRunId,
            candidateEvaluationRunId,
          ),
        ),
      )
      .limit(1);
    return row === undefined ? null : evaluationComparisonFromRow(row);
  }

  async listComparisonsByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly import("@osva/domain").EvaluationComparison[]> {
    const page = await this.listComparisons({ workspaceId, limit });
    return page.comparisons;
  }

  async listComparisons(
    query: ListEvaluationComparisonsQuery,
  ): Promise<ListEvaluationComparisonsResult> {
    const conditions: SQL[] = [
      eq(evaluationComparisons.workspaceId, query.workspaceId),
    ];
    if (query.status !== undefined) {
      conditions.push(eq(evaluationComparisons.status, query.status));
    }
    if (query.evaluationSuiteVersionId !== undefined) {
      conditions.push(
        eq(
          evaluationComparisons.evaluationSuiteVersionId,
          query.evaluationSuiteVersionId,
        ),
      );
    }
    if (query.baselineEvaluationRunId !== undefined) {
      conditions.push(
        eq(
          evaluationComparisons.baselineEvaluationRunId,
          query.baselineEvaluationRunId,
        ),
      );
    }
    if (query.candidateEvaluationRunId !== undefined) {
      conditions.push(
        eq(
          evaluationComparisons.candidateEvaluationRunId,
          query.candidateEvaluationRunId,
        ),
      );
    }
    if (query.cursor !== undefined) {
      const cursorCondition = or(
        lt(evaluationComparisons.createdAt, query.cursor.createdAt),
        and(
          eq(evaluationComparisons.createdAt, query.cursor.createdAt),
          lt(evaluationComparisons.id, query.cursor.id),
        ),
      );
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(evaluationComparisons)
      .where(and(...conditions))
      .orderBy(
        desc(evaluationComparisons.createdAt),
        desc(evaluationComparisons.id),
      )
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      comparisons: page.map(evaluationComparisonFromRow),
      nextCursor:
        hasMore && last !== undefined
          ? {
              createdAt: last.createdAt,
              id: last.id as EvaluationComparisonId,
            }
          : undefined,
    };
  }

  async listComparisonsPendingReconciliation(
    limit: number,
  ): Promise<readonly import("@osva/domain").EvaluationComparison[]> {
    const rows = await this.database.sql<
      (typeof evaluationComparisons.$inferSelect)[]
    >`
      select c.*
      from evaluation_comparisons c
      where c.status = 'RUNNING'
        and c.pairwise_config is not null
        and not exists (
          select 1
          from evaluation_comparison_pairwise_tasks t
          where t.comparison_id = c.id
            and t.status in ('PENDING', 'RUNNING')
        )
      order by c.updated_at asc, c.id asc
      limit ${limit}
    `;
    return rows.map((row) =>
      evaluationComparisonFromSqlRow(row as Record<string, unknown>),
    );
  }
}
