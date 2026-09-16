import type { EvaluationId, RunAttemptId } from "@osva/contracts";
import type { Evaluation } from "@osva/domain";
import type { EvaluationRepository } from "@osva/domain";
import { asc, eq } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  evaluationFromRow,
  evaluationToRow,
} from "../mappers/evaluation-mapper.js";
import { withMappedDatabaseErrors } from "../postgres-errors.js";
import { evaluations } from "../schema/evaluations.js";

export class PostgresEvaluationRepository implements EvaluationRepository {
  constructor(private readonly database: Database) {}

  async saveEvaluation(evaluation: Evaluation): Promise<void> {
    await withMappedDatabaseErrors(
      () =>
        this.database.db
          .insert(evaluations)
          .values(evaluationToRow(evaluation)),
      {
        evaluations_pkey: `An Evaluation with id '${evaluation.id}' already exists.`,
        evaluations_run_attempt_same_run_fk:
          "Evaluation must reference a RunAttempt that belongs to the same Run.",
      },
    );
  }

  async findEvaluationById(id: EvaluationId): Promise<Evaluation | null> {
    const [row] = await this.database.db
      .select()
      .from(evaluations)
      .where(eq(evaluations.id, id))
      .limit(1);

    return row === undefined ? null : evaluationFromRow(row);
  }

  async listEvaluationsByRunAttempt(
    runAttemptId: RunAttemptId,
  ): Promise<readonly Evaluation[]> {
    const rows = await this.database.db
      .select()
      .from(evaluations)
      .where(eq(evaluations.runAttemptId, runAttemptId))
      .orderBy(asc(evaluations.createdAt), asc(evaluations.id));

    return rows.map(evaluationFromRow);
  }
}
