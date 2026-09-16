import type { EvaluationId, RunAttemptId } from "@osva/contracts";
import { DomainInvariantError, type Evaluation } from "@osva/domain";
import type { EvaluationRepository } from "@osva/domain";

export class MemoryEvaluationRepository implements EvaluationRepository {
  private readonly evaluations = new Map<EvaluationId, Evaluation>();

  async saveEvaluation(evaluation: Evaluation): Promise<void> {
    if (this.evaluations.has(evaluation.id)) {
      throw new DomainInvariantError(
        `An Evaluation with id '${evaluation.id}' already exists.`,
      );
    }

    this.evaluations.set(evaluation.id, evaluation);
  }

  async findEvaluationById(id: EvaluationId): Promise<Evaluation | null> {
    return this.evaluations.get(id) ?? null;
  }

  async listEvaluationsByRunAttempt(
    runAttemptId: RunAttemptId,
  ): Promise<readonly Evaluation[]> {
    return [...this.evaluations.values()]
      .filter((evaluation) => evaluation.runAttemptId === runAttemptId)
      .sort((left, right) => {
        const createdDelta =
          left.createdAt.getTime() - right.createdAt.getTime();
        if (createdDelta !== 0) {
          return createdDelta;
        }

        if (left.id < right.id) {
          return -1;
        }

        if (left.id > right.id) {
          return 1;
        }

        return 0;
      });
  }

  listAll(): readonly Evaluation[] {
    return Object.freeze([...this.evaluations.values()]);
  }
}
