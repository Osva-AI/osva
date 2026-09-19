import { describe, expect, it, vi } from "vitest";

import { ProcessDueTimerWaits } from "../src/process-due-timer-waits.js";
import { ProcessResolvableEventWaits } from "../src/process-resolvable-event-waits.js";
import { WorkflowWaitDriverTick } from "../src/workflow-wait-driver-tick.js";

describe("WorkflowWaitDriverTick", () => {
  it("invokes TIMER then EVENT processors with the same now", async () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const timer = { execute: vi.fn(async () => []) };
    const events = { execute: vi.fn(async () => []) };
    const driver = new WorkflowWaitDriverTick({
      processDueTimerWaits: timer as unknown as ProcessDueTimerWaits,
      processResolvableEventWaits:
        events as unknown as ProcessResolvableEventWaits,
      batchLimit: 7,
    });

    await driver.execute(now);

    expect(timer.execute).toHaveBeenCalledWith(now, 7);
    expect(events.execute).toHaveBeenCalledWith(now, 7);
    expect(timer.execute.mock.invocationCallOrder[0]).toBeLessThan(
      events.execute.mock.invocationCallOrder[0]!,
    );
  });
});
