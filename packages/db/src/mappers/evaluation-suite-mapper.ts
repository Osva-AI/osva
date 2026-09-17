import type {
  EvaluationCaseId,
  EvaluationCaseOutcome,
  EvaluationCaseResultId,
  EvaluationRunId,
  EvaluationRunState,
  EvaluationRunTargetType,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  EvaluatorConfig,
  JsonValue,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationRun,
  EvaluationSuite,
  EvaluationSuiteVersion,
} from "@osva/domain";

import type { evaluationCaseResults } from "../schema/evaluation-case-results.js";
import type { evaluationCases } from "../schema/evaluation-cases.js";
import type { evaluationRuns } from "../schema/evaluation-runs.js";
import type { evaluationSuiteVersions } from "../schema/evaluation-suite-versions.js";
import type { evaluationSuites } from "../schema/evaluation-suites.js";
import { toDomainDate } from "./timestamps.js";

type EvaluationSuiteRow = typeof evaluationSuites.$inferSelect;
type EvaluationSuiteVersionRow = typeof evaluationSuiteVersions.$inferSelect;
type EvaluationCaseRow = typeof evaluationCases.$inferSelect;
type EvaluationRunRow = typeof evaluationRuns.$inferSelect;
type EvaluationCaseResultRow = typeof evaluationCaseResults.$inferSelect;

export function evaluationSuiteToRow(suite: EvaluationSuite) {
  return {
    id: suite.id,
    workspaceId: suite.workspaceId,
    key: suite.key,
    name: suite.name,
    description: suite.description ?? null,
    createdAt: suite.createdAt,
    updatedAt: suite.updatedAt,
  };
}

export function evaluationSuiteFromRow(
  row: EvaluationSuiteRow,
): EvaluationSuite {
  return EvaluationSuite.create({
    id: row.id as EvaluationSuiteId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}

export function evaluationSuiteVersionToRow(version: EvaluationSuiteVersion) {
  return {
    id: version.id,
    evaluationSuiteId: version.evaluationSuiteId,
    workspaceId: version.workspaceId,
    version: version.version,
    createdAt: version.createdAt,
  };
}

export function evaluationSuiteVersionFromRow(
  row: EvaluationSuiteVersionRow,
): EvaluationSuiteVersion {
  return EvaluationSuiteVersion.rehydrate({
    id: row.id as EvaluationSuiteVersionId,
    evaluationSuiteId: row.evaluationSuiteId as EvaluationSuiteId,
    workspaceId: row.workspaceId as WorkspaceId,
    version: row.version,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function evaluationCaseToRow(evaluationCase: EvaluationCase) {
  return {
    id: evaluationCase.id,
    evaluationSuiteVersionId: evaluationCase.evaluationSuiteVersionId,
    key: evaluationCase.key,
    name: evaluationCase.name ?? null,
    input: evaluationCase.input,
    expected: evaluationCase.expected ?? null,
    evaluator: evaluationCase.evaluator,
    createdAt: evaluationCase.createdAt,
  };
}

export function evaluationCaseFromRow(row: EvaluationCaseRow): EvaluationCase {
  return EvaluationCase.create({
    id: row.id as EvaluationCaseId,
    evaluationSuiteVersionId:
      row.evaluationSuiteVersionId as EvaluationSuiteVersionId,
    key: row.key,
    name: row.name ?? undefined,
    input: row.input as JsonValue,
    expected: (row.expected ?? undefined) as JsonValue | undefined,
    evaluator: row.evaluator as EvaluatorConfig,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function isSameEvaluationCase(
  left: EvaluationCase,
  right: EvaluationCase,
): boolean {
  return (
    left.id === right.id &&
    left.evaluationSuiteVersionId === right.evaluationSuiteVersionId &&
    left.key === right.key &&
    left.name === right.name &&
    JSON.stringify(left.input) === JSON.stringify(right.input) &&
    JSON.stringify(left.expected) === JSON.stringify(right.expected) &&
    JSON.stringify(left.evaluator) === JSON.stringify(right.evaluator) &&
    left.createdAt.getTime() === right.createdAt.getTime()
  );
}

export function isSameEvaluationSuiteVersion(
  left: EvaluationSuiteVersion,
  right: EvaluationSuiteVersion,
): boolean {
  return (
    left.id === right.id &&
    left.evaluationSuiteId === right.evaluationSuiteId &&
    left.workspaceId === right.workspaceId &&
    left.version === right.version &&
    left.createdAt.getTime() === right.createdAt.getTime()
  );
}

export function evaluationRunToRow(evaluationRun: EvaluationRun) {
  return {
    id: evaluationRun.id,
    workspaceId: evaluationRun.workspaceId,
    evaluationSuiteVersionId: evaluationRun.evaluationSuiteVersionId,
    targetType: evaluationRun.targetType,
    targetVersionId: evaluationRun.targetVersionId,
    status: evaluationRun.status,
    startedAt: evaluationRun.startedAt ?? null,
    completedAt: evaluationRun.completedAt ?? null,
    cancelledAt: evaluationRun.cancelledAt ?? null,
    createdAt: evaluationRun.createdAt,
    updatedAt: evaluationRun.updatedAt,
  };
}

export function evaluationRunFromRow(row: EvaluationRunRow): EvaluationRun {
  return EvaluationRun.rehydrate({
    id: row.id as EvaluationRunId,
    workspaceId: row.workspaceId as WorkspaceId,
    evaluationSuiteVersionId:
      row.evaluationSuiteVersionId as EvaluationSuiteVersionId,
    targetType: row.targetType as EvaluationRunTargetType,
    targetVersionId: row.targetVersionId,
    status: row.status as EvaluationRunState,
    startedAt: row.startedAt === null ? undefined : toDomainDate(row.startedAt),
    completedAt:
      row.completedAt === null ? undefined : toDomainDate(row.completedAt),
    cancelledAt:
      row.cancelledAt === null ? undefined : toDomainDate(row.cancelledAt),
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}

export function evaluationCaseResultToRow(result: EvaluationCaseResult) {
  return {
    id: result.id,
    evaluationRunId: result.evaluationRunId,
    evaluationCaseId: result.evaluationCaseId,
    runId: result.runId,
    outcome: result.outcome,
    evaluatorResults: result.evaluatorResults,
    createdAt: result.createdAt,
    completedAt: result.completedAt ?? null,
  };
}

export function evaluationCaseResultFromRow(
  row: EvaluationCaseResultRow,
): EvaluationCaseResult {
  return EvaluationCaseResult.create({
    id: row.id as EvaluationCaseResultId,
    evaluationRunId: row.evaluationRunId as EvaluationRunId,
    evaluationCaseId: row.evaluationCaseId as EvaluationCaseId,
    runId: row.runId as RunId,
    outcome: row.outcome as EvaluationCaseOutcome,
    evaluatorResults: row.evaluatorResults,
    createdAt: toDomainDate(row.createdAt),
    completedAt:
      row.completedAt === null ? undefined : toDomainDate(row.completedAt),
  });
}

export function isSameEvaluationCaseResult(
  left: EvaluationCaseResult,
  right: EvaluationCaseResult,
): boolean {
  return (
    left.id === right.id &&
    left.evaluationRunId === right.evaluationRunId &&
    left.evaluationCaseId === right.evaluationCaseId &&
    left.runId === right.runId &&
    left.outcome === right.outcome &&
    JSON.stringify(left.evaluatorResults) ===
      JSON.stringify(right.evaluatorResults) &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    left.completedAt?.getTime() === right.completedAt?.getTime()
  );
}
