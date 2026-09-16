export const APPROVAL_REQUEST_STATES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

export type ApprovalRequestState = (typeof APPROVAL_REQUEST_STATES)[number];

export const TERMINAL_APPROVAL_REQUEST_STATES = [
  "APPROVED",
  "REJECTED",
] as const;

export type TerminalApprovalRequestState =
  (typeof TERMINAL_APPROVAL_REQUEST_STATES)[number];

export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_DECISION_COMMENT_MAX_LENGTH = 4000;

export const APPROVAL_REJECTED_ERROR_CODE = "APPROVAL_REJECTED";
