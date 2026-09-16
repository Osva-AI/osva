import {
  APPROVAL_REQUEST_STATES,
  TERMINAL_APPROVAL_REQUEST_STATES,
  type ApprovalRequestState,
  type TerminalApprovalRequestState,
} from "@osva/contracts";

import { InvalidApprovalRequestTransitionError } from "./errors.js";

export const LEGAL_APPROVAL_REQUEST_TRANSITIONS: ReadonlyArray<
  readonly [ApprovalRequestState, ApprovalRequestState]
> = [
  ["PENDING", "APPROVED"],
  ["PENDING", "REJECTED"],
];

const LEGAL_APPROVAL_REQUEST_TRANSITION_KEYS = new Set(
  LEGAL_APPROVAL_REQUEST_TRANSITIONS.map(([from, to]) =>
    transitionKey(from, to),
  ),
);

const TERMINAL_APPROVAL_REQUEST_STATE_SET = new Set<ApprovalRequestState>(
  TERMINAL_APPROVAL_REQUEST_STATES,
);

export function isApprovalRequestState(
  value: string,
): value is ApprovalRequestState {
  return (APPROVAL_REQUEST_STATES as readonly string[]).includes(value);
}

export function isTerminalApprovalRequestState(
  state: ApprovalRequestState,
): state is TerminalApprovalRequestState {
  return TERMINAL_APPROVAL_REQUEST_STATE_SET.has(state);
}

export function isLegalApprovalRequestTransition(
  from: ApprovalRequestState,
  to: ApprovalRequestState,
): boolean {
  return LEGAL_APPROVAL_REQUEST_TRANSITION_KEYS.has(transitionKey(from, to));
}

export function assertLegalApprovalRequestTransition(
  from: ApprovalRequestState,
  to: ApprovalRequestState,
): void {
  if (!isLegalApprovalRequestTransition(from, to)) {
    throw new InvalidApprovalRequestTransitionError(from, to);
  }
}

function transitionKey(
  from: ApprovalRequestState,
  to: ApprovalRequestState,
): string {
  return `${from}->${to}`;
}
