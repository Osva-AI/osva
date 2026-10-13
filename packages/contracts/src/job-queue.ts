import type { RunAttemptId } from "./ids.js";

export interface JobQueuePayload {
  readonly runAttemptId: RunAttemptId;
}

export type JobQueueHandler = (payload: JobQueuePayload) => Promise<void>;

export const JOB_ENQUEUE_OUTCOMES = ["enqueued", "already_present"] as const;

export type JobEnqueueOutcome = (typeof JOB_ENQUEUE_OUTCOMES)[number];

export interface JobEnqueueResult {
  readonly outcome: JobEnqueueOutcome;
}

/**
 * Dispatches work without exposing queue-engine semantics.
 * A delivery references a RunAttempt; redelivery reuses the same identity.
 * OSVA decides when a new RunAttempt exists.
 */
export interface JobQueue {
  enqueue(runAttemptId: RunAttemptId): Promise<JobEnqueueResult>;
  cancel(runAttemptId: RunAttemptId): Promise<void>;
  consume(handler: JobQueueHandler): Promise<void>;
  shutdown(): Promise<void>;
}
