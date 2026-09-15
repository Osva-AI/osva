import type { EvaluationId, RunAttemptId } from "@osva/contracts";

import type { Evaluation } from "../evaluation.js";

export interface EvaluationRepository {
  saveEvaluation(evaluation: Evaluation): Promise<void>;
  findEvaluationById(id: EvaluationId): Promise<Evaluation | null>;
  listEvaluationsByRunAttempt(
    runAttemptId: RunAttemptId,
  ): Promise<readonly Evaluation[]>;
}
