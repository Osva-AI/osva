import {
  WORKFLOW_NODE_RUN_STATES,
  TERMINAL_WORKFLOW_NODE_RUN_STATES,
  type WorkflowNodeRunState,
  type TerminalWorkflowNodeRunState,
} from "@osva/contracts";

import { InvalidWorkflowNodeRunTransitionError } from "./errors.js";

export const LEGAL_WORKFLOW_NODE_RUN_TRANSITIONS: ReadonlyArray<
  readonly [WorkflowNodeRunState, WorkflowNodeRunState]
> = [
  ["PENDING", "RUNNING"],
  ["PENDING", "FAILED"],
  ["PENDING", "SKIPPED"],
  ["RUNNING", "SUCCEEDED"],
  ["RUNNING", "FAILED"],
];

const LEGAL_WORKFLOW_NODE_RUN_TRANSITION_KEYS = new Set(
  LEGAL_WORKFLOW_NODE_RUN_TRANSITIONS.map(([from, to]) =>
    transitionKey(from, to),
  ),
);

const TERMINAL_WORKFLOW_NODE_RUN_STATE_SET = new Set<WorkflowNodeRunState>(
  TERMINAL_WORKFLOW_NODE_RUN_STATES,
);

export function isWorkflowNodeRunState(
  value: string,
): value is WorkflowNodeRunState {
  return (WORKFLOW_NODE_RUN_STATES as readonly string[]).includes(value);
}

export function isTerminalWorkflowNodeRunState(
  state: WorkflowNodeRunState,
): state is TerminalWorkflowNodeRunState {
  return TERMINAL_WORKFLOW_NODE_RUN_STATE_SET.has(state);
}

export function isLegalWorkflowNodeRunTransition(
  from: WorkflowNodeRunState,
  to: WorkflowNodeRunState,
): boolean {
  return LEGAL_WORKFLOW_NODE_RUN_TRANSITION_KEYS.has(transitionKey(from, to));
}

export function assertLegalWorkflowNodeRunTransition(
  from: WorkflowNodeRunState,
  to: WorkflowNodeRunState,
): void {
  if (!isLegalWorkflowNodeRunTransition(from, to)) {
    throw new InvalidWorkflowNodeRunTransitionError(from, to);
  }
}

function transitionKey(
  from: WorkflowNodeRunState,
  to: WorkflowNodeRunState,
): string {
  return `${from}->${to}`;
}
