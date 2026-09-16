import type {
  EvaluationId,
  EvaluatorType,
  JsonValue,
  RunAttemptId,
  RunId,
} from "@osva/contracts";
import { Evaluation } from "@osva/domain";

import type { evaluations } from "../schema/evaluations.js";
import { toDomainDate } from "./timestamps.js";

type EvaluationRow = typeof evaluations.$inferSelect;

export function evaluationToRow(evaluation: Evaluation) {
  return {
    id: evaluation.id,
    runId: evaluation.runId,
    runAttemptId: evaluation.runAttemptId,
    evaluatorType: evaluation.evaluatorType,
    expected: evaluation.expected,
    passed: evaluation.passed,
    score: evaluation.score,
    createdAt: evaluation.createdAt,
  };
}

export function evaluationFromRow(row: EvaluationRow): Evaluation {
  return Evaluation.create({
    id: row.id as EvaluationId,
    runId: row.runId as RunId,
    runAttemptId: row.runAttemptId as RunAttemptId,
    evaluatorType: row.evaluatorType as EvaluatorType,
    expected: row.expected as JsonValue,
    passed: row.passed,
    score: row.score,
    createdAt: toDomainDate(row.createdAt),
  });
}
