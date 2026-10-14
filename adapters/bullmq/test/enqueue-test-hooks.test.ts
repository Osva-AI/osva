import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BullMqJobQueue } from "../src/bullmq-job-queue.js";
import type { EnqueueClaimTestHooks } from "../src/enqueue-test-hooks.js";
import type { RunAttemptId } from "@osva-ai/contracts";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "./integration/valkey-harness.js";

const RUN_ATTEMPT = "hooks-run-attempt" as RunAttemptId;

describe("enqueue claim test hooks (Valkey)", () => {
  let valkey: ValkeyTestContext | undefined;

  beforeAll(async () => {
    valkey = await startValkeyForTests();
  }, 120_000);

  afterAll(async () => {
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  it("does not activate hooks from environment variables alone", async () => {
    if (!valkey) {
      throw new Error("Valkey test context was not initialized");
    }
    process.env.OSVA_ENQUEUE_CLAIM_TEST_HOOKS = "1";
    const queue = new BullMqJobQueue({
      url: valkey.url,
      prefix: `hooks-env-${String(process.pid)}`,
    });
    try {
      expect(await queue.enqueue(RUN_ATTEMPT)).toEqual({ outcome: "enqueued" });
      await queue.cancel(RUN_ATTEMPT);
    } finally {
      delete process.env.OSVA_ENQUEUE_CLAIM_TEST_HOOKS;
      await queue.shutdown();
    }
  });

  it("fires claim and cancel boundaries in order when injected", async () => {
    if (!valkey) {
      throw new Error("Valkey test context was not initialized");
    }
    const events: string[] = [];
    const hooks: EnqueueClaimTestHooks = {
      beforeClaim: () => {
        events.push("beforeClaim");
      },
      afterClaimBeforeAdd: () => {
        events.push("afterClaimBeforeAdd");
      },
      afterAddBeforeReturn: () => {
        events.push("afterAddBeforeReturn");
      },
      beforeCancelRemove: () => {
        events.push("beforeCancelRemove");
      },
      afterCancelRemoveBeforeClaimClear: () => {
        events.push("afterCancelRemoveBeforeClaimClear");
      },
    };

    const queue = new BullMqJobQueue({
      url: valkey.url,
      prefix: `hooks-${String(process.pid)}`,
      enqueueClaimTestHooks: hooks,
    });
    try {
      expect(await queue.enqueue(RUN_ATTEMPT)).toEqual({ outcome: "enqueued" });
      await queue.cancel(RUN_ATTEMPT);
      expect(events).toEqual([
        "beforeClaim",
        "afterClaimBeforeAdd",
        "afterAddBeforeReturn",
        "beforeCancelRemove",
        "afterCancelRemoveBeforeClaimClear",
      ]);
    } finally {
      await queue.shutdown();
    }
  });

  it("allows a barrier after claim acquisition before add", async () => {
    if (!valkey) {
      throw new Error("Valkey test context was not initialized");
    }
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new BullMqJobQueue({
      url: valkey.url,
      prefix: `hooks-gate-${String(process.pid)}`,
      enqueueClaimTestHooks: {
        afterClaimBeforeAdd: async () => {
          await gate;
        },
      },
    });
    try {
      const pending = queue.enqueue(RUN_ATTEMPT);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const raw = new Queue("osva-execution", {
        connection: { url: valkey.url, maxRetriesPerRequest: null },
        prefix: `hooks-gate-${String(process.pid)}`,
      });
      try {
        expect(await raw.getJobCounts("wait", "active")).toMatchObject({
          wait: 0,
          active: 0,
        });
      } finally {
        await raw.close();
      }
      release?.();
      expect(await pending).toEqual({ outcome: "enqueued" });
    } finally {
      await queue.shutdown();
    }
  });
});
