import type { JobQueue } from "@osva/contracts";

/**
 * Control-plane enqueue stand-in until Stage 1.3 introduces BullMQ.
 * enqueue resolves so CreateRun can complete; nothing is consumed.
 */
export class DiscardingJobQueue implements JobQueue {
  async enqueue(): Promise<void> {}

  async cancel(): Promise<void> {}

  async consume(): Promise<void> {}

  async shutdown(): Promise<void> {}
}
