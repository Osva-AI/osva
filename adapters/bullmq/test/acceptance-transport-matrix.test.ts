import type { RunAttemptId } from "@osva-ai/contracts";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BullMqJobQueue } from "../src/bullmq-job-queue.js";
import type { EnqueueClaimTestHooks } from "../src/enqueue-test-hooks.js";
import { OSVA_EXECUTION_QUEUE_NAME } from "../src/constants.js";
import { toBullMqJobId } from "../src/job-id.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "./integration/valkey-harness.js";

const ATTEMPT = "matrix-run-attempt" as RunAttemptId;

describe("M9.7B.2B transport concurrency matrix", () => {
  let valkey: ValkeyTestContext;
  let counter = 0;

  beforeAll(async () => {
    valkey = await startValkeyForTests();
  }, 120_000);

  afterAll(async () => {
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  function prefix(): string {
    counter += 1;
    return `matrix-${String(process.pid)}-${String(counter)}`;
  }

  it("A: two concurrent enqueues yield one enqueued and one already_present", async () => {
    const queue = new BullMqJobQueue({ url: valkey.url, prefix: prefix() });
    try {
      const [a, b] = await Promise.all([
        queue.enqueue(ATTEMPT),
        queue.enqueue(ATTEMPT),
      ]);
      const outcomes = [a.outcome, b.outcome].sort();
      expect(outcomes).toEqual(["already_present", "enqueued"]);
      expect(await queue.countActiveJobs()).toBe(1);
    } finally {
      await queue.shutdown();
    }
  });

  it("B: stale claim expires and a retry enqueues a new job", async () => {
    const p = prefix();
    const queue = new BullMqJobQueue({ url: valkey.url, prefix: p });
    const jobId = toBullMqJobId(ATTEMPT);
    try {
      await queue.enqueue(ATTEMPT);
      await queue.cancel(ATTEMPT);
      const raw = new Queue(OSVA_EXECUTION_QUEUE_NAME, {
        connection: { url: valkey.url, maxRetriesPerRequest: null },
        prefix: p,
      });
      try {
        const client = await raw.client;
        const claimKey = `${raw.toKey("osva-enqueue-claim")}:${jobId}`;
        await client.set(claimKey, "stale", "PX", 40);
        await delay(80);
      } finally {
        await raw.close();
      }
      expect(await queue.enqueue(ATTEMPT)).toEqual({ outcome: "enqueued" });
    } finally {
      await queue.shutdown();
    }
  });

  it("C: delayed claim holder returns already_present to a concurrent caller", async () => {
    const p = prefix();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new BullMqJobQueue({
      url: valkey.url,
      prefix: p,
      enqueueClaimTestHooks: {
        afterClaimBeforeAdd: async () => {
          await gate;
        },
      },
    });
    try {
      const pending = queue.enqueue(ATTEMPT);
      await delay(60);
      const second = await queue.enqueue(ATTEMPT);
      expect(second.outcome).toBe("already_present");
      release?.();
      await pending;
      expect(await queue.getQueuedJob(ATTEMPT)).not.toBeNull();
    } finally {
      await queue.shutdown();
    }
  });

  it("D: cancel races enqueue before BullMQ add", async () => {
    const p = prefix();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hooks: EnqueueClaimTestHooks = {
      afterClaimBeforeAdd: async () => {
        await gate;
      },
    };
    const queue = new BullMqJobQueue({
      url: valkey.url,
      prefix: p,
      enqueueClaimTestHooks: hooks,
    });
    try {
      const pending = queue.enqueue(ATTEMPT);
      await delay(60);
      await queue.cancel(ATTEMPT);
      expect(await queue.getQueuedJob(ATTEMPT)).toBeNull();
      release?.();
      await pending.catch(() => undefined);
      expect(await queue.countActiveJobs()).toBeLessThanOrEqual(1);
    } finally {
      await queue.shutdown();
    }
  });

  it("E: cancel after add clears claim and waiting job", async () => {
    const queue = new BullMqJobQueue({ url: valkey.url, prefix: prefix() });
    try {
      expect(await queue.enqueue(ATTEMPT)).toEqual({ outcome: "enqueued" });
      await queue.cancel(ATTEMPT);
      expect(await queue.getQueuedJob(ATTEMPT)).toBeNull();
      expect(await queue.enqueue(ATTEMPT)).toEqual({ outcome: "enqueued" });
    } finally {
      await queue.shutdown();
    }
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
