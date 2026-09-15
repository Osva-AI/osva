import type { JobQueue, RunAttemptId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { JobQueueShutdownError } from "../src/errors.js";
import { MemoryJobQueue } from "../src/memory-job-queue.js";
import { runAttemptId, secondAttemptId } from "./fixtures.js";

const thirdAttemptId = "run-attempt-3" as RunAttemptId;

async function collectDeliveries(
  queue: JobQueue,
): Promise<readonly RunAttemptId[]> {
  const delivered: RunAttemptId[] = [];
  await queue.consume(async (payload) => {
    delivered.push(payload.runAttemptId);
  });
  return delivered;
}

describe("MemoryJobQueue", () => {
  it("enqueues a runAttemptId and consume delivers only that payload", async () => {
    const queue: JobQueue = new MemoryJobQueue();
    await queue.enqueue(runAttemptId);

    const delivered = await collectDeliveries(queue);

    expect(delivered).toEqual([runAttemptId]);
  });

  it("delivers multiple jobs in FIFO order", async () => {
    const queue: JobQueue = new MemoryJobQueue();
    await queue.enqueue(runAttemptId);
    await queue.enqueue(secondAttemptId);
    await queue.enqueue(thirdAttemptId);

    expect(await collectDeliveries(queue)).toEqual([
      runAttemptId,
      secondAttemptId,
      thirdAttemptId,
    ]);
  });

  it("redelivers the same runAttemptId without changing attempt identity", async () => {
    const queue: JobQueue = new MemoryJobQueue();
    await queue.enqueue(runAttemptId);
    expect(await collectDeliveries(queue)).toEqual([runAttemptId]);

    await queue.enqueue(runAttemptId);
    const redelivered = await collectDeliveries(queue);

    expect(redelivered).toEqual([runAttemptId]);
    expect(redelivered[0]).toBe(runAttemptId);
  });

  it("exposes only runAttemptId on each delivery", async () => {
    const queue: JobQueue = new MemoryJobQueue();
    await queue.enqueue(runAttemptId);

    await queue.consume(async (payload) => {
      expect(Object.keys(payload)).toEqual(["runAttemptId"]);
      expect(payload.runAttemptId).toBe(runAttemptId);
    });
  });

  it("cancel prevents pending delivery", async () => {
    const queue: JobQueue = new MemoryJobQueue();
    await queue.enqueue(runAttemptId);
    await queue.enqueue(secondAttemptId);
    await queue.cancel(runAttemptId);

    expect(await collectDeliveries(queue)).toEqual([secondAttemptId]);
  });

  it("cancelling an unknown item is a no-op", async () => {
    const queue: JobQueue = new MemoryJobQueue();
    await queue.enqueue(runAttemptId);

    await expect(queue.cancel(secondAttemptId)).resolves.toBeUndefined();
    expect(await collectDeliveries(queue)).toEqual([runAttemptId]);
  });

  it("leaves a failed delivery pending for later redelivery", async () => {
    const queue: JobQueue = new MemoryJobQueue();
    await queue.enqueue(runAttemptId);
    await queue.enqueue(secondAttemptId);

    await expect(
      queue.consume(async (payload) => {
        if (payload.runAttemptId === runAttemptId) {
          throw new Error("handler failed");
        }
      }),
    ).rejects.toThrow("handler failed");

    expect(await collectDeliveries(queue)).toEqual([
      runAttemptId,
      secondAttemptId,
    ]);
  });

  it("shutdown closes the adapter without discarding or processing pending jobs", async () => {
    const queue = new MemoryJobQueue();
    const delivered: RunAttemptId[] = [];
    await queue.enqueue(runAttemptId);
    await queue.enqueue(secondAttemptId);

    await queue.shutdown();

    expect(queue.pendingRunAttemptIds()).toEqual([
      runAttemptId,
      secondAttemptId,
    ]);
    expect(delivered).toEqual([]);

    const port: JobQueue = queue;
    await expect(port.enqueue(thirdAttemptId)).rejects.toThrow(
      JobQueueShutdownError,
    );
    await expect(
      port.consume(async (payload) => {
        delivered.push(payload.runAttemptId);
      }),
    ).rejects.toThrow(JobQueueShutdownError);

    expect(delivered).toEqual([]);
    expect(queue.pendingRunAttemptIds()).toEqual([
      runAttemptId,
      secondAttemptId,
    ]);
  });
});
