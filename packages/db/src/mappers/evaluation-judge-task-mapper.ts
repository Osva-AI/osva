import type { EvaluationJudgeTaskId } from "@osva-ai/contracts";
import {
  EvaluationJudgeTask,
  type EvaluationJudgeTaskSnapshot,
  type EvaluationJudgeTaskTerminalResult,
} from "@osva/domain";

import type { evaluationJudgeTasks } from "../schema/evaluation-judge-tasks.js";

type EvaluationJudgeTaskRow = typeof evaluationJudgeTasks.$inferSelect;

export function evaluationJudgeTaskToRow(
  task: EvaluationJudgeTask,
): typeof evaluationJudgeTasks.$inferInsert {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    evaluationRunId: task.evaluationRunId,
    evaluationCaseId: task.evaluationCaseId,
    runId: task.runId,
    runAttemptId: task.runAttemptId,
    snapshot: task.snapshot as unknown as Readonly<Record<string, unknown>>,
    status: task.status,
    attemptCount: task.attemptCount,
    maxAttempts: task.maxAttempts,
    executionOwner: task.executionOwner ?? null,
    executionGeneration: task.executionGeneration,
    leaseExpiresAt: task.leaseExpiresAt ?? null,
    terminalResult:
      task.terminalResult === undefined
        ? null
        : (task.terminalResult as unknown as Readonly<Record<string, unknown>>),
    errorCode: task.errorCode ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt ?? null,
  };
}

function sqlDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function optionalSqlDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : sqlDate(value);
}

export function evaluationJudgeTaskFromSqlRow(
  row: Record<string, unknown>,
): EvaluationJudgeTask {
  return evaluationJudgeTaskFromRow({
    id: row.id,
    workspaceId: row.workspace_id,
    evaluationRunId: row.evaluation_run_id,
    evaluationCaseId: row.evaluation_case_id,
    runId: row.run_id,
    runAttemptId: row.run_attempt_id,
    snapshot: row.snapshot,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    executionOwner: row.execution_owner,
    executionGeneration: row.execution_generation,
    leaseExpiresAt: optionalSqlDate(row.lease_expires_at),
    terminalResult: row.terminal_result,
    errorCode: row.error_code,
    createdAt: sqlDate(row.created_at),
    updatedAt: sqlDate(row.updated_at),
    completedAt: optionalSqlDate(row.completed_at),
  } as EvaluationJudgeTaskRow);
}

export function evaluationJudgeTaskFromRow(
  row: EvaluationJudgeTaskRow,
): EvaluationJudgeTask {
  return EvaluationJudgeTask.restore({
    id: row.id as EvaluationJudgeTaskId,
    workspaceId: row.workspaceId as never,
    evaluationRunId: row.evaluationRunId as never,
    evaluationCaseId: row.evaluationCaseId as never,
    runId: row.runId as never,
    runAttemptId: row.runAttemptId as never,
    snapshot: row.snapshot as unknown as EvaluationJudgeTaskSnapshot,
    status: row.status as never,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    executionOwner: row.executionOwner ?? undefined,
    executionGeneration: row.executionGeneration,
    leaseExpiresAt: row.leaseExpiresAt ?? undefined,
    terminalResult:
      row.terminalResult === null
        ? undefined
        : (row.terminalResult as unknown as EvaluationJudgeTaskTerminalResult),
    errorCode: row.errorCode ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? undefined,
  });
}
