import { describe, expect, it } from "vitest";

import type { Database } from "@osva/db";

import { createWorkerProcess } from "../src/process.js";

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

describe("createWorkerProcess", () => {
  it("starts after readiness and stops database resources idempotently", async () => {
    let closeCalls = 0;
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
      },
      () =>
        fakeDatabase(() => {
          closeCalls += 1;
        }),
    );

    await worker.start();
    expect(worker.status()).toBe("running");

    await worker.stop();
    await worker.stop();
    expect(worker.status()).toBe("stopped");
    expect(closeCalls).toBe(1);
  });

  it("does not enter running when PostgreSQL readiness fails", async () => {
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
      },
      () => ({
        sql: {} as Database["sql"],
        db: {} as Database["db"],
        ping: async () => {
          throw new Error("ECONNREFUSED postgres://secret@127.0.0.1/osva");
        },
        close: async () => undefined,
      }),
    );

    await expect(worker.start()).rejects.toThrow("PostgreSQL is unavailable.");
    expect(worker.status()).toBe("created");
    await worker.stop();
  });
});
