import type { ValkeyStringCommands } from "../src/valkey-string-store.js";

interface StoredEntry {
  readonly value: string;
  readonly expiresAtMs: number;
}

export class FakeValkeyStringStore implements ValkeyStringCommands {
  private readonly entries = new Map<string, StoredEntry>();
  private readonly clock: () => number;
  private failNext = false;

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
  }

  failNextCommand(): void {
    this.failNext = true;
  }

  async get(key: string): Promise<string | null> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("connect ECONNREFUSED");
    }
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.expiresAtMs <= this.clock()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async setNxEx(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<"OK" | null> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("connect ECONNREFUSED");
    }
    const existing = await this.get(key);
    if (existing !== null) {
      return null;
    }
    this.entries.set(key, {
      value,
      expiresAtMs: this.clock() + ttlSeconds * 1_000,
    });
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.entries.delete(key) ? 1 : 0;
  }
}
