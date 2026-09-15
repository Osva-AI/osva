import type {
  JobQueue,
  JobQueueHandler,
  JobQueuePayload,
  RunAttemptId,
} from "@osva/contracts";

import { JobQueueShutdownError } from "./errors.js";

/**
 * One-process deterministic JobQueue for Stage 0 tests and composition.
 * It is not a distributed or cross-process queue and must not wire
 * apps/web to apps/worker.
 *
 * enqueue never creates a RunAttempt. Redelivery is another delivery of the
 * same runAttemptId. consume() processes currently pending jobs in FIFO order
 * and then returns. shutdown() closes the consumer without deleting pending
 * jobs. No timers, polling loops, or worker threads.
 */
export class MemoryJobQueue implements JobQueue {
  private readonly pending: RunAttemptId[] = [];
  private closed = false;

  async enqueue(runAttemptId: RunAttemptId): Promise<void> {
    this.assertOpen("enqueue");
    this.pending.push(runAttemptId);
  }

  async cancel(runAttemptId: RunAttemptId): Promise<void> {
    if (this.closed) {
      return;
    }

    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index] === runAttemptId) {
        this.pending.splice(index, 1);
      }
    }
  }

  async consume(handler: JobQueueHandler): Promise<void> {
    this.assertOpen("consume");

    const batch = this.pending.splice(0, this.pending.length);

    for (let index = 0; index < batch.length; index += 1) {
      const runAttemptId = batch[index];
      if (runAttemptId === undefined) {
        continue;
      }

      const payload: JobQueuePayload = Object.freeze({ runAttemptId });

      try {
        await handler(payload);
      } catch (error) {
        this.pending.unshift(...batch.slice(index));
        throw error;
      }
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
  }

  /**
   * Test helper: FIFO snapshot of runAttemptIds waiting to be consumed.
   * Not part of the JobQueue contract.
   */
  pendingRunAttemptIds(): readonly RunAttemptId[] {
    return [...this.pending];
  }

  private assertOpen(operation: string): void {
    if (this.closed) {
      throw new JobQueueShutdownError(operation);
    }
  }
}
