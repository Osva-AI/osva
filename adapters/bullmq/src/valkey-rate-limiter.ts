import { Redis } from "ioredis";

import { ValkeyUnavailableError } from "./errors.js";

const INCR_EXPIRE_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

export type RateLimitConsumeResult =
  | {
      readonly outcome: "allowed";
      readonly remaining: number;
    }
  | {
      readonly outcome: "throttled";
      readonly retryAfterSeconds: number;
    };

export interface ValkeyFixedWindowRateLimiterOptions {
  readonly url: string;
  readonly redis?: Redis;
}

export class ValkeyFixedWindowRateLimiter {
  private readonly redis: Redis;
  private readonly ownsConnection: boolean;
  private connecting: Promise<void> | undefined;

  constructor(options: ValkeyFixedWindowRateLimiterOptions) {
    this.ownsConnection = options.redis === undefined;
    this.redis =
      options.redis ??
      new Redis(options.url, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
        commandTimeout: 2_000,
        enableOfflineQueue: false,
        enableReadyCheck: true,
      });
    this.redis.on("error", () => {
      // Request paths map connection failures to ValkeyUnavailableError.
    });
  }

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitConsumeResult> {
    let raw: unknown;
    try {
      await this.ensureConnected();
      raw = await this.redis.eval(
        INCR_EXPIRE_LUA,
        1,
        key,
        String(windowSeconds),
      );
    } catch {
      throw new ValkeyUnavailableError();
    }

    const count = numericRedisValue(raw, 0);
    const ttl = numericRedisValue(raw, 1);
    if (count > limit) {
      return {
        outcome: "throttled",
        retryAfterSeconds: Math.max(1, ttl > 0 ? ttl : windowSeconds),
      };
    }

    return { outcome: "allowed", remaining: Math.max(0, limit - count) };
  }

  private async ensureConnected(): Promise<void> {
    if (isRedisReady(this.redis)) {
      return;
    }
    if (this.connecting !== undefined) {
      await this.connecting;
      if (!isRedisReady(this.redis)) {
        throw new ValkeyUnavailableError();
      }
      return;
    }

    this.connecting = this.connectOnce().finally(() => {
      this.connecting = undefined;
    });
    await this.connecting;
  }

  private async connectOnce(): Promise<void> {
    if (isRedisReady(this.redis)) {
      return;
    }
    if (
      this.redis.status === "wait" ||
      this.redis.status === "end" ||
      this.redis.status === "close"
    ) {
      await this.redis.connect();
      return;
    }
    await waitForRedisReady(this.redis, 5_000);
  }

  async close(): Promise<void> {
    if (!this.ownsConnection) {
      return;
    }

    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

function isRedisReady(redis: Redis): boolean {
  return redis.status === "ready";
}

function waitForRedisReady(redis: Redis, timeoutMs: number): Promise<void> {
  if (redis.status === "ready") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new ValkeyUnavailableError());
    }, timeoutMs);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onFailure = () => {
      cleanup();
      reject(new ValkeyUnavailableError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      redis.off("ready", onReady);
      redis.off("error", onFailure);
      redis.off("end", onFailure);
      redis.off("close", onFailure);
    };
    redis.once("ready", onReady);
    redis.once("error", onFailure);
    redis.once("end", onFailure);
    redis.once("close", onFailure);
    if (redis.status === "ready") {
      cleanup();
      resolve();
    }
  });
}

function numericRedisValue(raw: unknown, index: number): number {
  if (!Array.isArray(raw)) {
    return 0;
  }
  const value = raw[index];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
