import { Redis } from "ioredis";

export interface ValkeyStringCommands {
  get(key: string): Promise<string | null>;
  setNxEx(key: string, value: string, ttlSeconds: number): Promise<"OK" | null>;
  del(key: string): Promise<number>;
}

export interface ValkeyStringStoreOptions {
  readonly url?: string;
  readonly redis?: Redis;
  readonly commandTimeoutMs?: number;
  readonly maxRetriesPerRequest?: number;
}

export class IoValkeyStringStore implements ValkeyStringCommands {
  private readonly redis: Redis;
  private readonly ownsConnection: boolean;
  private connecting: Promise<void> | undefined;

  constructor(options: ValkeyStringStoreOptions) {
    if (options.redis === undefined && options.url === undefined) {
      throw new Error("ValkeyStringStore requires url or redis.");
    }

    this.ownsConnection = options.redis === undefined;
    this.redis =
      options.redis ??
      new Redis(options.url!, {
        maxRetriesPerRequest: options.maxRetriesPerRequest ?? 1,
        connectTimeout: options.commandTimeoutMs ?? 2_000,
        commandTimeout: options.commandTimeoutMs ?? 2_000,
        enableOfflineQueue: false,
        enableReadyCheck: true,
      });

    this.redis.on("error", () => {
      // Mapped to infrastructure bypass at the cache adapter boundary.
    });
  }

  async get(key: string): Promise<string | null> {
    await this.ensureConnected();
    return this.redis.get(key);
  }

  async setNxEx(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<"OK" | null> {
    await this.ensureConnected();
    const result = await this.redis.set(key, value, "EX", ttlSeconds, "NX");
    return result === "OK" ? "OK" : null;
  }

  async del(key: string): Promise<number> {
    await this.ensureConnected();
    return this.redis.del(key);
  }

  private async ensureConnected(): Promise<void> {
    if (isRedisReady(this.redis)) {
      return;
    }
    if (this.connecting !== undefined) {
      await this.connecting;
      if (!isRedisReady(this.redis)) {
        throw new Error("Valkey connection unavailable.");
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
      reject(new Error("Valkey connection timeout."));
    }, timeoutMs);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onFailure = () => {
      cleanup();
      reject(new Error("Valkey connection failed."));
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

export function isInfrastructureError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("connection is closed") ||
    message.includes("connection closed") ||
    message.includes("maxretries") ||
    message.includes("offline") ||
    message.includes("readonly") ||
    message.includes("valkey connection")
  );
}
