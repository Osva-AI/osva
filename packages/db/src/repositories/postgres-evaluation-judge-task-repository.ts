import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type {
  EvaluationCaseId,
  EvaluationJudgeTaskId,
  EvaluationRunId,
} from "@osva-ai/contracts";
import { EvaluationJudgeTask } from "@osva/domain";
import type {
  ClaimEvaluationJudgeTaskLeaseCommand,
  EvaluationJudgeTaskRepository,
} from "@osva/domain";

import type { Database } from "../database.js";
import {
  evaluationJudgeTaskFromRow,
  evaluationJudgeTaskFromSqlRow,
  evaluationJudgeTaskToRow,
} from "../mappers/evaluation-judge-task-mapper.js";
import { evaluationJudgeTasks } from "../schema/evaluation-judge-tasks.js";

export class PostgresEvaluationJudgeTaskRepository implements EvaluationJudgeTaskRepository {
  constructor(private readonly database: Database) {}

  async saveJudgeTaskIfAbsent(
    task: EvaluationJudgeTask,
  ): Promise<"created" | "existing"> {
    await this.database.db
      .insert(evaluationJudgeTasks)
      .values(evaluationJudgeTaskToRow(task))
      .onConflictDoNothing({
        target: [
          evaluationJudgeTasks.evaluationRunId,
          evaluationJudgeTasks.evaluationCaseId,
        ],
      });

    const stored = await this.findJudgeTaskByRunAndCase(
      task.evaluationRunId,
      task.evaluationCaseId,
    );
    return stored?.id === task.id ? "created" : "existing";
  }

  async findJudgeTaskByRunAndCase(
    evaluationRunId: EvaluationRunId,
    evaluationCaseId: EvaluationCaseId,
  ): Promise<EvaluationJudgeTask | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationJudgeTasks)
      .where(
        and(
          eq(evaluationJudgeTasks.evaluationRunId, evaluationRunId),
          eq(evaluationJudgeTasks.evaluationCaseId, evaluationCaseId),
        ),
      )
      .limit(1);
    return row === undefined ? null : evaluationJudgeTaskFromRow(row);
  }

  async findJudgeTaskById(
    id: EvaluationJudgeTaskId,
  ): Promise<EvaluationJudgeTask | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluationJudgeTasks)
      .where(eq(evaluationJudgeTasks.id, id))
      .limit(1);
    return row === undefined ? null : evaluationJudgeTaskFromRow(row);
  }

  async listJudgeTasksForRecovery(
    limit: number,
    now: Date,
  ): Promise<readonly EvaluationJudgeTask[]> {
    const rows = await this.database.db
      .select()
      .from(evaluationJudgeTasks)
      .where(
        or(
          eq(evaluationJudgeTasks.status, "PENDING"),
          and(
            eq(evaluationJudgeTasks.status, "RUNNING"),
            or(
              isNull(evaluationJudgeTasks.leaseExpiresAt),
              lt(evaluationJudgeTasks.leaseExpiresAt, now),
            ),
          ),
        ),
      )
      .orderBy(
        asc(evaluationJudgeTasks.createdAt),
        asc(evaluationJudgeTasks.id),
      )
      .limit(limit);

    return rows.map(evaluationJudgeTaskFromRow);
  }

  async claimJudgeTaskLease(
    command: ClaimEvaluationJudgeTaskLeaseCommand,
  ): Promise<EvaluationJudgeTask | null> {
    const leaseExpiresAt = command.leaseExpiresAt.toISOString();
    const nowIso = command.now.toISOString();
    const rows = await this.database.sql<
      (typeof evaluationJudgeTasks.$inferSelect)[]
    >`
      update evaluation_judge_tasks
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
      : evaluationJudgeTaskFromSqlRow(row as Record<string, unknown>);
  }

  async saveJudgeTaskTerminal(task: EvaluationJudgeTask): Promise<boolean> {
    const rows = await this.database.db
      .update(evaluationJudgeTasks)
      .set(evaluationJudgeTaskToRow(task))
      .where(
        and(
          eq(evaluationJudgeTasks.id, task.id),
          eq(evaluationJudgeTasks.workspaceId, task.workspaceId),
          eq(
            evaluationJudgeTasks.executionGeneration,
            task.executionGeneration,
          ),
          eq(evaluationJudgeTasks.status, "RUNNING"),
        ),
      )
      .returning({ id: evaluationJudgeTasks.id });
    return rows.length > 0;
  }

  async appendJudgeInvocationAttempt(command: {
    readonly taskId: EvaluationJudgeTaskId;
    readonly workspaceId: import("@osva-ai/contracts").WorkspaceId;
    readonly executionGeneration: number;
    readonly attempt: Readonly<Record<string, unknown>>;
  }): Promise<boolean> {
    const attemptJson = JSON.stringify(command.attempt);
    const rows = await this.database.sql<
      (typeof evaluationJudgeTasks.$inferSelect)[]
    >`
      update evaluation_judge_tasks
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

  async listTerminalJudgeTasksMissingCaseResult(
    limit: number,
  ): Promise<readonly EvaluationJudgeTask[]> {
    const rows = await this.database.sql<
      (typeof evaluationJudgeTasks.$inferSelect)[]
    >`
      select t.*
      from evaluation_judge_tasks t
      left join evaluation_case_results r
        on r.evaluation_run_id = t.evaluation_run_id
       and r.evaluation_case_id = t.evaluation_case_id
      where t.status in ('SUCCEEDED', 'FAILED')
        and r.id is null
      order by t.created_at asc, t.id asc
      limit ${limit}
    `;
    return rows.map((row) =>
      evaluationJudgeTaskFromSqlRow(row as Record<string, unknown>),
    );
  }

  async countNonTerminalJudgeTasksByRun(
    evaluationRunId: EvaluationRunId,
  ): Promise<number> {
    const [row] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(evaluationJudgeTasks)
      .where(
        and(
          eq(evaluationJudgeTasks.evaluationRunId, evaluationRunId),
          inArray(evaluationJudgeTasks.status, ["PENDING", "RUNNING"]),
        ),
      );
    return row?.count ?? 0;
  }
}
