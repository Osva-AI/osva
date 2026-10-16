import { describe, expect, it } from "vitest";

import { pollUntil } from "./poll-until.js";

describe("pollUntil", () => {
  it("waits for delayed asynchronous completion", async () => {
    const readyAt = performance.now() + 150;
    await pollUntil(async () => performance.now() >= readyAt, {
      timeoutMs: 5_000,
      pollIntervalMs: 25,
      label: "delayed readiness",
    });
  });

  it("times out with diagnostics when the condition never becomes true", async () => {
    await expect(
      pollUntil(async () => false, {
        timeoutMs: 80,
        pollIntervalMs: 20,
        label: "never-ready",
        onTimeout: async () => ({ observed: "still false" }),
      }),
    ).rejects.toThrow(/Timed out after 80ms waiting for never-ready/);

    await expect(
      pollUntil(async () => false, {
        timeoutMs: 80,
        pollIntervalMs: 20,
        label: "never-ready",
        onTimeout: async () => ({ observed: "still false" }),
      }),
    ).rejects.toThrow(/"observed":"still false"/);
  });
});
