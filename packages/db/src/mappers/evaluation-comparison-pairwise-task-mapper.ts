import type { EvaluationComparisonPairwiseTaskId } from "@osva-ai/contracts";
import {
  EvaluationComparisonPairwiseTask,
  type EvaluationComparisonPairwiseTaskSnapshot,
  type EvaluationComparisonPairwiseTaskTerminalResult,
} from "@osva/domain";

import type { evaluationComparisonPairwiseTasks } from "../schema/evaluation-comparisons.js";

type PairwiseTaskRow = typeof evaluationComparisonPairwiseTasks.$inferSelect;

function sqlDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function optionalSqlDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : sqlDate(value);
}

export function evaluationComparisonPairwiseTaskToRow(
  task: EvaluationComparisonPairwiseTask,
): typeof evaluationComparisonPairwiseTasks.$inferInsert {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    comparisonId: task.comparisonId,
    evaluationCaseId: task.evaluationCaseId,
    judgmentPosition: task.judgmentPosition,
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

export function evaluationComparisonPairwiseTaskFromSqlRow(
  row: Record<string, unknown>,
): EvaluationComparisonPairwiseTask {
  return evaluationComparisonPairwiseTaskFromRow({
    id: row.id,
    workspaceId: row.workspace_id,
    comparisonId: row.comparison_id,
    evaluationCaseId: row.evaluation_case_id,
    judgmentPosition: row.judgment_position,
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
  } as PairwiseTaskRow);
}

export function evaluationComparisonPairwiseTaskFromRow(
  row: PairwiseTaskRow,
): EvaluationComparisonPairwiseTask {
  return new EvaluationComparisonPairwiseTask({
    id: row.id as EvaluationComparisonPairwiseTaskId,
    workspaceId: row.workspaceId as never,
    comparisonId: row.comparisonId as never,
    evaluationCaseId: row.evaluationCaseId as never,
    judgmentPosition: row.judgmentPosition as never,
    snapshot:
      row.snapshot as unknown as EvaluationComparisonPairwiseTaskSnapshot,
    status: row.status as never,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    executionOwner: row.executionOwner ?? undefined,
    executionGeneration: row.executionGeneration,
    leaseExpiresAt: row.leaseExpiresAt ?? undefined,
    terminalResult:
      row.terminalResult === null
        ? undefined
        : (row.terminalResult as unknown as EvaluationComparisonPairwiseTaskTerminalResult),
    errorCode: row.errorCode ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? undefined,
  });
}
