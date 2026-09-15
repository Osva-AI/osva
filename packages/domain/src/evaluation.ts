import type {
  EvaluationId,
  EvaluatorType,
  JsonValue,
  RunAttemptId,
  RunId,
} from "@osva/contracts";
import { isEvaluatorType } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant } from "./internals.js";

export interface EvaluationProps {
  readonly id: EvaluationId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly evaluatorType: EvaluatorType;
  readonly expected: JsonValue;
  readonly passed: boolean;
  readonly score: number;
  readonly createdAt: Date;
}

export class Evaluation {
  readonly id: EvaluationId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly evaluatorType: EvaluatorType;
  readonly expected: JsonValue;
  readonly passed: boolean;
  readonly score: number;
  readonly createdAt: Date;

  private constructor(props: EvaluationProps) {
    this.id = props.id;
    this.runId = props.runId;
    this.runAttemptId = props.runAttemptId;
    this.evaluatorType = props.evaluatorType;
    this.expected = props.expected;
    this.passed = props.passed;
    this.score = props.score;
    this.createdAt = props.createdAt;
  }

  static create(props: EvaluationProps): Evaluation {
    if (!props.id) {
      throw new DomainInvariantError("Evaluation.id is required.");
    }

    if (!props.runId) {
      throw new DomainInvariantError("Evaluation.runId is required.");
    }

    if (!props.runAttemptId) {
      throw new DomainInvariantError("Evaluation.runAttemptId is required.");
    }

    if (!isEvaluatorType(props.evaluatorType)) {
      throw new DomainInvariantError("Evaluation.evaluatorType is invalid.");
    }

    if (!Number.isFinite(props.score)) {
      throw new DomainInvariantError("Evaluation.score must be finite.");
    }

    if (props.evaluatorType === "JSON_EXACT_MATCH") {
      if (props.passed && props.score !== 1) {
        throw new DomainInvariantError(
          "JSON_EXACT_MATCH pass requires score 1.",
        );
      }

      if (!props.passed && props.score !== 0) {
        throw new DomainInvariantError(
          "JSON_EXACT_MATCH fail requires score 0.",
        );
      }
    }

    return Object.freeze(
      new Evaluation({
        id: props.id,
        runId: props.runId,
        runAttemptId: props.runAttemptId,
        evaluatorType: props.evaluatorType,
        expected: props.expected,
        passed: props.passed,
        score: props.score,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
