import type { BatchInferenceJobStatus } from "./batch-inference.js";

export const BATCH_INFERENCE_TERMINAL_JOB_STATUSES = [
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const satisfies readonly BatchInferenceJobStatus[];

export type BatchInferenceTerminalJobStatus =
  (typeof BATCH_INFERENCE_TERMINAL_JOB_STATUSES)[number];

const ALLOWED_TRANSITIONS: Readonly<
  Record<BatchInferenceJobStatus, readonly BatchInferenceJobStatus[]>
> = {
  CREATED: ["SUBMITTING", "FAILED", "CANCELLED"],
  SUBMITTING: ["SUBMITTED", "FAILED", "CANCELLING", "CANCELLED", "EXPIRED"],
  SUBMITTED: ["PROCESSING", "FINALIZING", "FAILED", "CANCELLING", "EXPIRED"],
  PROCESSING: [
    "FINALIZING",
    "FAILED",
    "CANCELLING",
    "EXPIRED",
    "PARTIALLY_COMPLETED",
    "COMPLETED",
  ],
  FINALIZING: [
    "COMPLETED",
    "PARTIALLY_COMPLETED",
    "FAILED",
    "CANCELLING",
    "EXPIRED",
  ],
  COMPLETED: [],
  PARTIALLY_COMPLETED: [],
  FAILED: [],
  CANCELLING: ["CANCELLED", "PARTIALLY_COMPLETED", "FAILED", "EXPIRED"],
  CANCELLED: [],
  EXPIRED: [],
};

export function isBatchInferenceTerminalJobStatus(
  status: BatchInferenceJobStatus,
): status is BatchInferenceTerminalJobStatus {
  return (BATCH_INFERENCE_TERMINAL_JOB_STATUSES as readonly string[]).includes(
    status,
  );
}

export function canTransitionBatchInferenceJobStatus(
  from: BatchInferenceJobStatus,
  to: BatchInferenceJobStatus,
): boolean {
  if (from === to) {
    return true;
  }
  if (isBatchInferenceTerminalJobStatus(from)) {
    return false;
  }
  return (ALLOWED_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function assertBatchInferenceJobStatusTransition(
  from: BatchInferenceJobStatus,
  to: BatchInferenceJobStatus,
): void {
  if (!canTransitionBatchInferenceJobStatus(from, to)) {
    throw new Error(
      `Illegal batch inference job status transition: ${from} -> ${to}`,
    );
  }
}
