import fs from "node:fs/promises";
import os from "node:os";
import { describe, expect, it } from "vitest";

import type { Database } from "@osva/db";

import { createWorkerProcess } from "../src/process.js";
import { createFakePingableQueue } from "./fake-queue.js";

function fakeDatabase(onClose: () => void): Database {
  return {
    sql: {} as Database["sql"],
    db: {} as Database["db"],
    ping: async () => undefined,
    close: async () => {
      onClose();
    },
  };
}

const TEST_ENV = {
  OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
  OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
};

const STUB_RUNTIME = {
  async execute() {
    return { status: "succeeded" as const, output: { ok: true } };
  },
};

describe("createWorkerProcess", () => {
  it("starts after readiness and stops queue and database resources idempotently", async () => {
    let closeCalls = 0;
    const queue = createFakePingableQueue();
    const worker = createWorkerProcess(
      TEST_ENV,
      () =>
        fakeDatabase(() => {
          closeCalls += 1;
        }),
      { queueFactory: () => queue, runtime: STUB_RUNTIME },
    );

    await worker.start();
    expect(worker.status()).toBe("running");
    expect(queue.consumeCalls).toBe(1);

    await worker.stop();
    await worker.stop();
    expect(worker.status()).toBe("stopped");
    expect(closeCalls).toBe(1);
  });

  it("starts queue consumption when a runtime is provided", async () => {
    const queue = createFakePingableQueue();
    const worker = createWorkerProcess(
      TEST_ENV,
      () => fakeDatabase(() => undefined),
      {
        queueFactory: () => queue,
        runtime: STUB_RUNTIME,
      },
    );

    await worker.start();
    expect(queue.consumeCalls).toBe(1);
    await worker.stop();
  });

  it("consumes with the production trusted TypeScript runtime when the root is valid", async () => {
    const queue = createFakePingableQueue();
    const trustedRuntimeRoot = await fs.mkdtemp(
      `${os.tmpdir()}/osva-worker-runtime-`,
    );
    expect(TEST_ENV).not.toHaveProperty("OPENAI_API_KEY");
    const worker = createWorkerProcess(
      {
        ...TEST_ENV,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      },
      () => fakeDatabase(() => undefined),
      { queueFactory: () => queue },
    );

    await worker.start();
    expect(worker.status()).toBe("running");
    expect(queue.consumeCalls).toBe(1);
    await worker.stop();
  });

  it("does not enter running when the trusted runtime root is missing", async () => {
    const worker = createWorkerProcess(
      TEST_ENV,
      () => fakeDatabase(() => undefined),
      { queueFactory: () => createFakePingableQueue() },
    );

    await expect(worker.start()).rejects.toThrow(
      "OSVA_TRUSTED_RUNTIME_ROOT is required.",
    );
    expect(worker.status()).toBe("created");
    await worker.stop();
  });

  it("does not enter running when PostgreSQL readiness fails", async () => {
    const worker = createWorkerProcess(
      TEST_ENV,
      () => ({
        sql: {} as Database["sql"],
        db: {} as Database["db"],
        ping: async () => {
          throw new Error("ECONNREFUSED postgres://secret@127.0.0.1/osva");
        },
        close: async () => undefined,
      }),
      { queueFactory: () => createFakePingableQueue() },
    );

    await expect(worker.start()).rejects.toThrow("PostgreSQL is unavailable.");
    expect(worker.status()).toBe("created");
    await worker.stop();
  });

  it("does not enter running when Valkey readiness fails", async () => {
    const queue = createFakePingableQueue();
    queue.ping = async () => {
      throw new Error("Valkey is unavailable.");
    };
    const worker = createWorkerProcess(
      TEST_ENV,
      () => fakeDatabase(() => undefined),
      { queueFactory: () => queue },
    );

    await expect(worker.start()).rejects.toThrow("Valkey is unavailable.");
    expect(worker.status()).toBe("created");
    await worker.stop();
  });
});
