import {
  EVALUATION_RUN_STATES,
  type EvaluationRunState,
} from "@osva/contracts";

import { InvalidEvaluationRunTransitionError } from "./errors.js";

export const LEGAL_EVALUATION_RUN_TRANSITIONS: ReadonlyArray<
  readonly [EvaluationRunState, EvaluationRunState]
> = [
  ["PENDING", "RUNNING"],
  ["PENDING", "CANCELLED"],
  ["PENDING", "FAILED"],
  ["RUNNING", "COMPLETED"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "CANCELLED"],
];

const LEGAL_EVALUATION_RUN_TRANSITION_KEYS = new Set(
  LEGAL_EVALUATION_RUN_TRANSITIONS.map(([from, to]) => transitionKey(from, to)),
);

export function isEvaluationRunState(
  value: string,
): value is EvaluationRunState {
  return (EVALUATION_RUN_STATES as readonly string[]).includes(value);
}

export function isLegalEvaluationRunTransition(
  from: EvaluationRunState,
  to: EvaluationRunState,
): boolean {
  return LEGAL_EVALUATION_RUN_TRANSITION_KEYS.has(transitionKey(from, to));
}

export function assertLegalEvaluationRunTransition(
  from: EvaluationRunState,
  to: EvaluationRunState,
): void {
  if (!isLegalEvaluationRunTransition(from, to)) {
    throw new InvalidEvaluationRunTransitionError(from, to);
  }
}

function transitionKey(
  from: EvaluationRunState,
  to: EvaluationRunState,
): string {
  return `${from}->${to}`;
}
