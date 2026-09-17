import type {
  EvaluationCaseId,
  EvaluationCaseOutcome,
  EvaluationCaseResultId,
  EvaluationRunId,
  RunId,
} from "@osva/contracts";
import { EVALUATION_CASE_OUTCOMES } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, deepFreeze } from "./internals.js";

export interface EvaluationCaseResultProps {
  readonly id: EvaluationCaseResultId;
  readonly evaluationRunId: EvaluationRunId;
  readonly evaluationCaseId: EvaluationCaseId;
  readonly runId: RunId;
  readonly outcome: EvaluationCaseOutcome;
  readonly evaluatorResults: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly completedAt?: Date;
}

export class EvaluationCaseResult {
  readonly id: EvaluationCaseResultId;
  readonly evaluationRunId: EvaluationRunId;
  readonly evaluationCaseId: EvaluationCaseId;
  readonly runId: RunId;
  readonly outcome: EvaluationCaseOutcome;
  readonly evaluatorResults: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly completedAt: Date | undefined;

  private constructor(props: EvaluationCaseResultProps) {
    this.id = props.id;
    this.evaluationRunId = props.evaluationRunId;
    this.evaluationCaseId = props.evaluationCaseId;
    this.runId = props.runId;
    this.outcome = props.outcome;
    this.evaluatorResults = props.evaluatorResults;
    this.createdAt = props.createdAt;
    this.completedAt = props.completedAt;
  }

  static create(props: EvaluationCaseResultProps): EvaluationCaseResult {
    if (!props.id) {
      throw new DomainInvariantError("EvaluationCaseResult.id is required.");
    }

    if (!props.evaluationRunId) {
      throw new DomainInvariantError(
        "EvaluationCaseResult.evaluationRunId is required.",
      );
    }

    if (!props.evaluationCaseId) {
      throw new DomainInvariantError(
        "EvaluationCaseResult.evaluationCaseId is required.",
      );
    }

    if (!props.runId) {
      throw new DomainInvariantError("EvaluationCaseResult.runId is required.");
    }

    if (!isEvaluationCaseOutcomeValue(props.outcome)) {
      throw new DomainInvariantError(
        "EvaluationCaseResult.outcome must be a supported outcome.",
      );
    }

    return Object.freeze(
      new EvaluationCaseResult({
        id: props.id,
        evaluationRunId: props.evaluationRunId,
        evaluationCaseId: props.evaluationCaseId,
        runId: props.runId,
        outcome: props.outcome,
        evaluatorResults: deepFreeze(props.evaluatorResults),
        createdAt: copyInstant(props.createdAt),
        completedAt:
          props.completedAt === undefined
            ? undefined
            : copyInstant(props.completedAt),
      }),
    );
  }
}

function isEvaluationCaseOutcomeValue(
  value: string,
): value is EvaluationCaseOutcome {
  return (EVALUATION_CASE_OUTCOMES as readonly string[]).includes(value);
}
