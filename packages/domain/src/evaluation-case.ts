import type {
  EvaluationCaseId,
  EvaluationSuiteVersionId,
  EvaluatorConfig,
  JsonValue,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, deepFreeze, requireNonEmptyString } from "./internals.js";

export interface EvaluationCaseProps {
  readonly id: EvaluationCaseId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly key: string;
  readonly name?: string;
  readonly input: JsonValue;
  readonly expected?: JsonValue;
  readonly evaluator: EvaluatorConfig;
  readonly createdAt: Date;
}

export class EvaluationCase {
  readonly id: EvaluationCaseId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly key: string;
  readonly name: string | undefined;
  readonly input: JsonValue;
  readonly expected: JsonValue | undefined;
  readonly evaluator: EvaluatorConfig;
  readonly createdAt: Date;

  private constructor(props: EvaluationCaseProps) {
    this.id = props.id;
    this.evaluationSuiteVersionId = props.evaluationSuiteVersionId;
    this.key = props.key;
    this.name = props.name;
    this.input = props.input;
    this.expected = props.expected;
    this.evaluator = props.evaluator;
    this.createdAt = props.createdAt;
  }

  static create(props: EvaluationCaseProps): EvaluationCase {
    if (!props.id) {
      throw new DomainInvariantError("EvaluationCase.id is required.");
    }

    if (!props.evaluationSuiteVersionId) {
      throw new DomainInvariantError(
        "EvaluationCase.evaluationSuiteVersionId is required.",
      );
    }

    return Object.freeze(
      new EvaluationCase({
        id: props.id,
        evaluationSuiteVersionId: props.evaluationSuiteVersionId,
        key: requireNonEmptyString(props.key, "EvaluationCase.key"),
        name:
          props.name === undefined
            ? undefined
            : requireNonEmptyString(props.name, "EvaluationCase.name"),
        input: props.input,
        expected: props.expected,
        evaluator: deepFreeze(props.evaluator),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
