import { describe, expect, it, vi } from "vitest";

import { InferenceBudgetReconciliationCoordinator } from "../src/inference-budget-reconciliation-coordinator.js";

describe("InferenceBudgetReconciliationCoordinator", () => {
  it("S8: coalesces concurrent schedules into one in-flight tick", async () => {
    let resolveTick: (() => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTick = resolve;
        }),
    );
    const coordinator = new InferenceBudgetReconciliationCoordinator({
      tick: {
        execute: async () => {
          await execute();
          return {
            scanned: 0,
            released: 0,
            markedReconciliationRequired: 0,
          };
        },
      },
      batchLimit: 5,
    });
    coordinator.schedule();
    coordinator.schedule();
    expect(execute).toHaveBeenCalledTimes(1);
    resolveTick?.();
    await new Promise((r) => setTimeout(r, 0));
    coordinator.schedule();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("S8: drain waits for in-flight tick", async () => {
    let resolveTick: (() => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTick = resolve;
        }),
    );
    const coordinator = new InferenceBudgetReconciliationCoordinator({
      tick: {
        execute: async () => {
          await execute();
          return {
            scanned: 0,
            released: 0,
            markedReconciliationRequired: 0,
          };
        },
      },
      batchLimit: 5,
    });
    coordinator.schedule();
    const drainPromise = coordinator.drain();
    resolveTick?.();
    await drainPromise;
    coordinator.schedule();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
