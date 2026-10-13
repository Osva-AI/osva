import { describe, expect, it } from "vitest";

import { OSVA_EXECUTION_QUEUE_NAME } from "../src/constants.js";
import { queueMetricLabel, queueTimeToStartMs } from "../src/queue-metrics.js";

describe("queue metric helpers", () => {
  it("bounds queue labels to execution or other", () => {
    expect(queueMetricLabel(OSVA_EXECUTION_QUEUE_NAME)).toBe("execution");
    expect(queueMetricLabel("custom-operator-queue")).toBe("other");
  });

  it("computes time-to-start only from trustworthy timestamps", () => {
    expect(queueTimeToStartMs(1_000, 1_250)).toBe(250);
    expect(queueTimeToStartMs(undefined, 1_250)).toBeUndefined();
    expect(queueTimeToStartMs(0, 1_250)).toBeUndefined();
    expect(queueTimeToStartMs(2_000, 1_250)).toBeUndefined();
  });
});
