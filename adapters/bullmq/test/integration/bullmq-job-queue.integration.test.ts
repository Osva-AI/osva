import type { JobQueueHandler, RunAttemptId } from "@osva/contracts";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BullMqJobQueue } from "../../src/bullmq-job-queue.js";
import {
  EXECUTE_RUN_ATTEMPT_JOB_NAME,
  OSVA_EXECUTION_QUEUE_NAME,
} from "../../src/constants.js";
import {
  JobQueueShutdownError,
  ValkeyUnavailableError,
} from "../../src/errors.js";
import { toBullMqJobId } from "../../src/job-id.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "./valkey-harness.js";

const FIRST = "run-attempt-1" as RunAttemptId;
const SECOND = "run-attempt-2" as RunAttemptId;

describe("BullMqJobQueue Valkey integration", () => {
  let context: ValkeyTestContext;
  let queueCounter = 0;

  beforeAll(async () => {
    context = await startValkeyForTests();
  });

  afterAll(async () => {
    if (context) {
      await stopValkeyForTests(context);
    }
  });

  function nextPrefix(): string {
    queueCounter += 1;
    return `osva-test-${String(process.pid)}-${String(queueCounter)}`;
  }

  async function createQueue(options?: {
    readonly logger?: ConstructorParameters<typeof BullMqJobQueue>[0]["logger"];
  }): Promise<BullMqJobQueue> {
    return new BullMqJobQueue({
      url: context.url,
      prefix: nextPrefix(),
      logger: options?.logger,
    });
  }

  async function waitForDelivery(
    delivered: RunAttemptId[],
    expected = 1,
  ): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (delivered.length < expected && Date.now() < deadline) {
      await delay(25);
    }
    expect(delivered).toHaveLength(expected);
  }

  it("pings Valkey before treating the queue as ready", async () => {
    const queue = await createQueue();
    try {
      await expect(queue.ping()).resolves.toBeUndefined();
    } finally {
      await queue.shutdown();
    }
  });

  it("rejects connectivity checks when Valkey is unreachable", async () => {
    const queue = new BullMqJobQueue({
      url: "redis://127.0.0.1:1",
      prefix: nextPrefix(),
    });
    try {
      await expect(queue.ping()).rejects.toBeInstanceOf(ValkeyUnavailableError);
      await expect(queue.ping()).rejects.toThrow("Valkey is unavailable.");
    } finally {
      await queue.shutdown();
    }
  });

  it("enqueues one execution job with the internal name, payload, and job ID", async () => {
    const queue = await createQueue();
    try {
      await queue.enqueue(FIRST);
      const job = await queue.getQueuedJob(FIRST);
      expect(job).not.toBeNull();
      expect(job?.name).toBe(EXECUTE_RUN_ATTEMPT_JOB_NAME);
      expect(job?.id).toBe(toBullMqJobId(FIRST));
      expect(job?.data).toEqual({ runAttemptId: FIRST });
      expect(Object.keys(job?.data as object)).toEqual(["runAttemptId"]);
    } finally {
      await queue.shutdown();
    }
  });

  it("does not create a second active job when the same RunAttempt is enqueued twice", async () => {
    const queue = await createQueue();
    try {
      await queue.enqueue(FIRST);
      await queue.enqueue(FIRST);
      expect(await queue.countActiveJobs()).toBe(1);
      expect(await queue.getQueuedJob(FIRST)).toMatchObject({
        id: toBullMqJobId(FIRST),
        data: { runAttemptId: FIRST },
      });
    } finally {
      await queue.shutdown();
    }
  });

  it("creates a distinct queue job for another RunAttempt", async () => {
    const queue = await createQueue();
    try {
      await queue.enqueue(FIRST);
      await queue.enqueue(SECOND);
      expect(await queue.countActiveJobs()).toBe(2);
      expect((await queue.getQueuedJob(FIRST))?.id).toBe(toBullMqJobId(FIRST));
      expect((await queue.getQueuedJob(SECOND))?.id).toBe(
        toBullMqJobId(SECOND),
      );
    } finally {
      await queue.shutdown();
    }
  });

  it("consumes a job and forwards only runAttemptId into the handler", async () => {
    const queue = await createQueue();
    const delivered: RunAttemptId[] = [];
    const keys: string[][] = [];
    try {
      await queue.consume(async (payload) => {
        keys.push(Object.keys(payload));
        delivered.push(payload.runAttemptId);
      });
      await queue.enqueue(FIRST);
      await waitForDelivery(delivered);
      expect(delivered).toEqual([FIRST]);
      expect(keys).toEqual([["runAttemptId"]]);
    } finally {
      await queue.shutdown();
    }
  });

  it("rejects a malformed payload before calling the execution handler", async () => {
    const prefix = nextPrefix();
    const delivered: RunAttemptId[] = [];
    const failures: unknown[] = [];
    const queue = new BullMqJobQueue({
      url: context.url,
      prefix,
      logger: {
        info() {
          return undefined;
        },
        error(_event, error) {
          failures.push(error);
        },
      },
    });
    try {
      await queue.consume(async (payload) => {
        delivered.push(payload.runAttemptId);
      });

      const raw = new Queue(OSVA_EXECUTION_QUEUE_NAME, {
        connection: { url: context.url, maxRetriesPerRequest: null },
        prefix,
      });
      try {
        await raw.add(
          EXECUTE_RUN_ATTEMPT_JOB_NAME,
          { runAttemptId: FIRST, input: { prompt: "no" } },
          { jobId: "malformed-payload" },
        );
      } finally {
        await raw.close();
      }

      const deadline = Date.now() + 8_000;
      while (failures.length === 0 && Date.now() < deadline) {
        await delay(25);
      }

      expect(failures.length).toBeGreaterThan(0);
      expect(delivered).toEqual([]);
    } finally {
      await queue.shutdown();
    }
  });

  it("rejects an unsupported job name before calling the execution handler", async () => {
    const prefix = nextPrefix();
    const queue = new BullMqJobQueue({ url: context.url, prefix });
    const delivered: RunAttemptId[] = [];
    try {
      await queue.consume(async (payload) => {
        delivered.push(payload.runAttemptId);
      });

      const raw = new Queue(OSVA_EXECUTION_QUEUE_NAME, {
        connection: { url: context.url, maxRetriesPerRequest: null },
        prefix,
      });
      try {
        await raw.add(
          "other-job",
          { runAttemptId: FIRST },
          { jobId: "unsupported-name" },
        );
      } finally {
        await raw.close();
      }

      await delay(500);
      expect(delivered).toEqual([]);
    } finally {
      await queue.shutdown();
    }
  });

  it("does not pass a BullMQ Job object or job ID into the handler", async () => {
    const queue = await createQueue();
    const received: unknown[] = [];
    try {
      const handler: JobQueueHandler = async (payload) => {
        received.push(payload);
      };
      await queue.consume(handler);
      await queue.enqueue(FIRST);
      const deadline = Date.now() + 8_000;
      while (received.length === 0 && Date.now() < deadline) {
        await delay(25);
      }
      expect(received).toHaveLength(1);
      const payload = received[0] as Record<string, unknown>;
      expect(payload).toEqual({ runAttemptId: FIRST });
      expect(payload).not.toHaveProperty("id");
      expect(payload).not.toHaveProperty("jobId");
      expect(payload).not.toHaveProperty("attemptsMade");
      expect(payload).not.toHaveProperty("queue");
    } finally {
      await queue.shutdown();
    }
  });

  it("lets multiple workers consume the same queue without duplicating delivery of one job", async () => {
    const prefix = nextPrefix();
    const first = new BullMqJobQueue({ url: context.url, prefix });
    const second = new BullMqJobQueue({ url: context.url, prefix });
    const delivered: RunAttemptId[] = [];
    try {
      await first.consume(async (payload) => {
        await delay(50);
        delivered.push(payload.runAttemptId);
      });
      await second.consume(async (payload) => {
        await delay(50);
        delivered.push(payload.runAttemptId);
      });
      await first.enqueue(FIRST);
      await waitForDelivery(delivered, 1);
      await delay(200);
      expect(delivered).toEqual([FIRST]);
    } finally {
      await first.shutdown();
      await second.shutdown();
    }
  });

  it("shuts down the worker without leaving the process hanging", async () => {
    const queue = await createQueue();
    await queue.consume(async () => undefined);
    const shutdown = queue.shutdown();
    await expect(
      Promise.race([
        shutdown.then(() => "closed"),
        delay(5_000).then(() => "timeout"),
      ]),
    ).resolves.toBe("closed");
  });

  it("rejects enqueue after shutdown", async () => {
    const queue = await createQueue();
    await queue.shutdown();
    await expect(queue.enqueue(FIRST)).rejects.toBeInstanceOf(
      JobQueueShutdownError,
    );
  });

  it("uses the Community Alpha execution queue name", () => {
    expect(OSVA_EXECUTION_QUEUE_NAME).toBe("osva-execution");
    expect(EXECUTE_RUN_ATTEMPT_JOB_NAME).toBe("execute-run-attempt");
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
