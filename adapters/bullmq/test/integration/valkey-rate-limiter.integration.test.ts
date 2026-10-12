import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ValkeyUnavailableError } from "../../src/errors.js";
import { ValkeyFixedWindowRateLimiter } from "../../src/valkey-rate-limiter.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "./valkey-harness.js";

describe("ValkeyFixedWindowRateLimiter integration", () => {
  let context: ValkeyTestContext;
  let prefixCounter = 0;

  beforeAll(async () => {
    context = await startValkeyForTests();
  });

  afterAll(async () => {
    if (context) {
      await stopValkeyForTests(context);
    }
  });

  function nextKey(label: string): string {
    prefixCounter += 1;
    return `osva:rl:itest:${String(process.pid)}:${String(prefixCounter)}:${label}`;
  }

  it("shares counters across two limiter instances and resets after the window", async () => {
    const first = new ValkeyFixedWindowRateLimiter({ url: context.url });
    const second = new ValkeyFixedWindowRateLimiter({ url: context.url });
    const key = nextKey("shared");
    try {
      expect(await first.consume(key, 2, 2)).toMatchObject({
        outcome: "allowed",
      });
      expect(await second.consume(key, 2, 2)).toMatchObject({
        outcome: "allowed",
      });
      const throttled = await first.consume(key, 2, 2);
      expect(throttled).toMatchObject({ outcome: "throttled" });
      if (throttled.outcome === "throttled") {
        expect(throttled.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(throttled.retryAfterSeconds).toBeLessThanOrEqual(2);
      }

      await delay(2_200);
      expect(await second.consume(key, 2, 2)).toMatchObject({
        outcome: "allowed",
      });
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("applies concurrent increments atomically", async () => {
    const limiter = new ValkeyFixedWindowRateLimiter({ url: context.url });
    const key = nextKey("concurrent");
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => limiter.consume(key, 5, 30)),
      );
      const allowed = results.filter((result) => result.outcome === "allowed");
      const throttled = results.filter(
        (result) => result.outcome === "throttled",
      );
      expect(allowed).toHaveLength(5);
      expect(throttled).toHaveLength(15);
    } finally {
      await limiter.close();
    }
  });

  it("fails closed on Valkey outage and works again on a healthy connection", async () => {
    const healthy = new ValkeyFixedWindowRateLimiter({ url: context.url });
    const key = nextKey("recovery");
    try {
      expect(await healthy.consume(key, 2, 30)).toMatchObject({
        outcome: "allowed",
      });

      const down = new Redis("redis://127.0.0.1:1", {
        maxRetriesPerRequest: 1,
        connectTimeout: 500,
        enableOfflineQueue: false,
        lazyConnect: true,
      });
      const unavailable = new ValkeyFixedWindowRateLimiter({
        url: "redis://127.0.0.1:1",
        redis: down,
      });
      await expect(unavailable.consume(key, 2, 30)).rejects.toBeInstanceOf(
        ValkeyUnavailableError,
      );
      await unavailable.close();
      try {
        await down.quit();
      } catch {
        down.disconnect();
      }

      expect(await healthy.consume(key, 2, 30)).toMatchObject({
        outcome: "allowed",
      });
      expect(await healthy.consume(key, 2, 30)).toMatchObject({
        outcome: "throttled",
      });
    } finally {
      await healthy.close();
    }
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
