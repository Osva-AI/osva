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
      { queueFactory: () => queue },
    );

    await worker.start();
    expect(worker.status()).toBe("running");
    expect(queue.consumeCalls).toBe(0);

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
        runtime: {
          async execute() {
            return { status: "succeeded", output: { ok: true } };
          },
        },
      },
    );

    await worker.start();
    expect(queue.consumeCalls).toBe(1);
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
