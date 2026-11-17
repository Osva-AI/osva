import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type {
  EvaluationCaseId,
  EvaluationComparisonId,
  EvaluationComparisonPairwiseJudgmentPosition,
  EvaluationComparisonPairwiseTaskId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type {
  ClaimComparisonPairwiseTaskLeaseCommand,
  EvaluationComparisonPairwiseTaskRepository,
} from "@osva/domain";

import type { Database } from "../database.js";
import {
  evaluationComparisonPairwiseTaskFromRow,
  evaluationComparisonPairwiseTaskFromSqlRow,
  evaluationComparisonPairwiseTaskToRow,
} from "../mappers/evaluation-comparison-pairwise-task-mapper.js";
import { evaluationComparisonPairwiseTasks } from "../schema/evaluation-comparisons.js";

export class PostgresEvaluationComparisonPairwiseTaskRepository implements EvaluationComparisonPairwiseTaskRepository {
  constructor(private readonly database: Database) {}

  async savePairwiseTaskIfAbsent(
    task: import("@osva/domain").EvaluationComparisonPairwiseTask,
  ): Promise<"created" | "existing"> {
    await this.database.db
      .insert(evaluationComparisonPairwiseTasks)
      .values(evaluationComparisonPairwiseTaskToRow(task))
      .onConflictDoNothing({
        target: [
          evaluationComparisonPairwiseTasks.comparisonId,
          evaluationComparisonPairwiseTasks.evaluationCaseId,
          evaluationComparisonPairwiseTasks.judgmentPosition,
        ],
      });

    const stored = await this.findPairwiseTask(
      task.comparisonId,
      task.evaluationCaseId,
      task.judgmentPosition,
    );
    return stored?.id === task.id ? "created" : "existing";
  }

  async findPairwiseTask(
    comparisonId: EvaluationComparisonId,
    evaluationCaseId: EvaluationCaseId,
    judgmentPosition: EvaluationComparisonPairwiseJudgmentPosition,
  ): Promise<import("@osva/domain").EvaluationComparisonPairwiseTask | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationComparisonPairwiseTasks)
      .where(
        and(
          eq(evaluationComparisonPairwiseTasks.comparisonId, comparisonId),
          eq(
            evaluationComparisonPairwiseTasks.evaluationCaseId,
            evaluationCaseId,
          ),
          eq(
            evaluationComparisonPairwiseTasks.judgmentPosition,
            judgmentPosition,
          ),
        ),
      )
      .limit(1);
    return row === undefined
      ? null
      : evaluationComparisonPairwiseTaskFromRow(row);
  }

  async findPairwiseTaskById(
    id: EvaluationComparisonPairwiseTaskId,
  ): Promise<import("@osva/domain").EvaluationComparisonPairwiseTask | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationComparisonPairwiseTasks)
      .where(eq(evaluationComparisonPairwiseTasks.id, id))
      .limit(1);
    return row === undefined
      ? null
      : evaluationComparisonPairwiseTaskFromRow(row);
  }

  async listPairwiseTasksForRecovery(
    limit: number,
    now: Date,
  ): Promise<
    readonly import("@osva/domain").EvaluationComparisonPairwiseTask[]
  > {
    const rows = await this.database.db
      .select()
      .from(evaluationComparisonPairwiseTasks)
      .where(
        or(
          eq(evaluationComparisonPairwiseTasks.status, "PENDING"),
          and(
            eq(evaluationComparisonPairwiseTasks.status, "RUNNING"),
            or(
              isNull(evaluationComparisonPairwiseTasks.leaseExpiresAt),
              lt(evaluationComparisonPairwiseTasks.leaseExpiresAt, now),
            ),
          ),
        ),
      )
      .orderBy(
        asc(evaluationComparisonPairwiseTasks.createdAt),
        asc(evaluationComparisonPairwiseTasks.id),
      )
      .limit(limit);

    return rows.map(evaluationComparisonPairwiseTaskFromRow);
  }

  async claimPairwiseTaskLease(
    command: ClaimComparisonPairwiseTaskLeaseCommand,
  ): Promise<import("@osva/domain").EvaluationComparisonPairwiseTask | null> {
    const leaseExpiresAt = command.leaseExpiresAt.toISOString();
    const nowIso = command.now.toISOString();
    const rows = await this.database.sql<
      (typeof evaluationComparisonPairwiseTasks.$inferSelect)[]
    >`
      update evaluation_comparison_pairwise_tasks
      set
        status = 'RUNNING',
        execution_owner = ${command.owner},
        execution_generation = ${command.generation},
        lease_expires_at = ${leaseExpiresAt},
        attempt_count = attempt_count + 1,
        updated_at = ${nowIso},
        error_code = null
      where id = ${command.taskId}
        and workspace_id = ${command.workspaceId}
        and (
          status = 'PENDING'
          or (
            status = 'RUNNING'
            and lease_expires_at is not null
            and lease_expires_at < ${nowIso}
          )
        )
      returning *
    `;
    const row = rows[0];
    return row === undefined
      ? null
      : evaluationComparisonPairwiseTaskFromSqlRow(
          row as Record<string, unknown>,
        );
  }

  async savePairwiseTaskTerminal(
    task: import("@osva/domain").EvaluationComparisonPairwiseTask,
  ): Promise<boolean> {
    const rows = await this.database.db
      .update(evaluationComparisonPairwiseTasks)
      .set(evaluationComparisonPairwiseTaskToRow(task))
      .where(
        and(
          eq(evaluationComparisonPairwiseTasks.id, task.id),
          eq(evaluationComparisonPairwiseTasks.workspaceId, task.workspaceId),
          eq(
            evaluationComparisonPairwiseTasks.executionGeneration,
            task.executionGeneration,
          ),
          eq(evaluationComparisonPairwiseTasks.status, "RUNNING"),
        ),
      )
      .returning({ id: evaluationComparisonPairwiseTasks.id });
    return rows.length > 0;
  }

  async appendPairwiseInvocationAttempt(command: {
    readonly taskId: EvaluationComparisonPairwiseTaskId;
    readonly workspaceId: WorkspaceId;
    readonly executionGeneration: number;
    readonly attempt: Readonly<Record<string, unknown>>;
  }): Promise<boolean> {
    const attemptJson = JSON.stringify(command.attempt);
    const rows = await this.database.sql<
      (typeof evaluationComparisonPairwiseTasks.$inferSelect)[]
    >`
      update evaluation_comparison_pairwise_tasks
      set
        terminal_result = jsonb_set(
          coalesce(terminal_result, '{}'::jsonb),
          '{invocationAttempts}',
          coalesce(terminal_result->'invocationAttempts', '[]'::jsonb) || ${attemptJson}::jsonb,
          true
        ),
        updated_at = now()
      where id = ${command.taskId}
        and workspace_id = ${command.workspaceId}
        and execution_generation = ${command.executionGeneration}
        and status = 'RUNNING'
      returning *
    `;
    return rows.length > 0;
  }

  async countNonTerminalPairwiseTasksByComparison(
    comparisonId: EvaluationComparisonId,
  ): Promise<number> {
    const [row] = await this.database.db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(evaluationComparisonPairwiseTasks)
      .where(
        and(
          eq(evaluationComparisonPairwiseTasks.comparisonId, comparisonId),
          inArray(evaluationComparisonPairwiseTasks.status, [
            "PENDING",
            "RUNNING",
          ]),
        ),
      );
    return row?.count ?? 0;
  }

  async listPairwiseTasksByComparison(
    workspaceId: WorkspaceId,
    comparisonId: EvaluationComparisonId,
  ): Promise<
    readonly import("@osva/domain").EvaluationComparisonPairwiseTask[]
  > {
    const rows = await this.database.db
      .select()
      .from(evaluationComparisonPairwiseTasks)
      .where(
        and(
          eq(evaluationComparisonPairwiseTasks.workspaceId, workspaceId),
          eq(evaluationComparisonPairwiseTasks.comparisonId, comparisonId),
        ),
      )
      .orderBy(
        asc(evaluationComparisonPairwiseTasks.evaluationCaseId),
        asc(evaluationComparisonPairwiseTasks.judgmentPosition),
      );
    return rows.map(evaluationComparisonPairwiseTaskFromRow);
  }

  async listSucceededPairwiseTasksByComparison(
    comparisonId: EvaluationComparisonId,
  ): Promise<
    readonly import("@osva/domain").EvaluationComparisonPairwiseTask[]
  > {
    const rows = await this.database.db
      .select()
      .from(evaluationComparisonPairwiseTasks)
      .where(
        and(
          eq(evaluationComparisonPairwiseTasks.comparisonId, comparisonId),
          eq(evaluationComparisonPairwiseTasks.status, "SUCCEEDED"),
        ),
      )
      .orderBy(
        asc(evaluationComparisonPairwiseTasks.evaluationCaseId),
        asc(evaluationComparisonPairwiseTasks.judgmentPosition),
      );
    return rows.map(evaluationComparisonPairwiseTaskFromRow);
  }
}
