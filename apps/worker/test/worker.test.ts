import { describe, expect, it } from "vitest";

import { createWorkerApplication } from "../src/worker.js";
import { loadWorkerConfig } from "../src/config.js";

describe("createWorkerApplication", () => {
  it("enters the running state after a successful readiness check", async () => {
    let readinessCalls = 0;
    const worker = createWorkerApplication({
      readinessCheck: async () => {
        readinessCalls += 1;
      },
    });

    expect(worker.status()).toBe("created");
    await worker.start();
    expect(worker.status()).toBe("running");
    expect(readinessCalls).toBe(1);
  });

  it("does not enter the running state when readiness fails", async () => {
    const worker = createWorkerApplication({
      readinessCheck: async () => {
        throw new Error("PostgreSQL is unavailable.");
      },
    });

    await expect(worker.start()).rejects.toThrow("PostgreSQL is unavailable.");
    expect(worker.status()).toBe("created");
  });

  it("closes cleanly and treats stop as idempotent", async () => {
    let closeCalls = 0;
    const worker = createWorkerApplication({
      readinessCheck: async () => undefined,
      onClose: async () => {
        closeCalls += 1;
      },
    });

    await worker.start();
    await worker.stop();
    await worker.stop();

    expect(worker.status()).toBe("stopped");
    expect(closeCalls).toBe(1);
  });

  it("does not expose an execution hook or process Runs", () => {
    const worker = createWorkerApplication({
      readinessCheck: async () => undefined,
    });

    expect(worker).not.toHaveProperty("execute");
    expect(worker).not.toHaveProperty("consume");
    expect(Object.keys(worker).sort()).toEqual(["start", "status", "stop"]);
  });
});

describe("loadWorkerConfig", () => {
  it("requires OSVA_DATABASE_URL without echoing its value", () => {
    expect(() => loadWorkerConfig({})).toThrow(
      "OSVA_DATABASE_URL is required.",
    );
  });
});
