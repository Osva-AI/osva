import {
  WORKFLOW_RUN_STATES,
  TERMINAL_WORKFLOW_RUN_STATES,
  type WorkflowRunState,
  type TerminalWorkflowRunState,
} from "@osva/contracts";

import { InvalidWorkflowRunTransitionError } from "./errors.js";

export const LEGAL_WORKFLOW_RUN_TRANSITIONS: ReadonlyArray<
  readonly [WorkflowRunState, WorkflowRunState]
> = [
  ["PENDING", "RUNNING"],
  ["PENDING", "FAILED"],
  ["RUNNING", "SUCCEEDED"],
  ["RUNNING", "FAILED"],
];

const LEGAL_WORKFLOW_RUN_TRANSITION_KEYS = new Set(
  LEGAL_WORKFLOW_RUN_TRANSITIONS.map(([from, to]) => transitionKey(from, to)),
);

const TERMINAL_WORKFLOW_RUN_STATE_SET = new Set<WorkflowRunState>(
  TERMINAL_WORKFLOW_RUN_STATES,
);

export function isWorkflowRunState(value: string): value is WorkflowRunState {
  return (WORKFLOW_RUN_STATES as readonly string[]).includes(value);
}

export function isTerminalWorkflowRunState(
  state: WorkflowRunState,
): state is TerminalWorkflowRunState {
  return TERMINAL_WORKFLOW_RUN_STATE_SET.has(state);
}

export function isLegalWorkflowRunTransition(
  from: WorkflowRunState,
  to: WorkflowRunState,
): boolean {
  return LEGAL_WORKFLOW_RUN_TRANSITION_KEYS.has(transitionKey(from, to));
}

export function assertLegalWorkflowRunTransition(
  from: WorkflowRunState,
  to: WorkflowRunState,
): void {
  if (!isLegalWorkflowRunTransition(from, to)) {
    throw new InvalidWorkflowRunTransitionError(from, to);
  }
}

function transitionKey(from: WorkflowRunState, to: WorkflowRunState): string {
  return `${from}->${to}`;
}
