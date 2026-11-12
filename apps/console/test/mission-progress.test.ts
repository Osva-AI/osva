import { describe, expect, it } from "vitest";

import {
  computeMissionProgress,
  unassignedTasks,
} from "../src/client/lib/mission-progress.js";

describe("computeMissionProgress", () => {
  it("counts assignment states for a single mission", () => {
    const goalId = "goal-1";
    const progress = computeMissionProgress(goalId, [
      { goalId, status: "PENDING" },
      { goalId, status: "RUNNING" },
      { goalId, status: "COMPLETED" },
      { goalId, status: "FAILED" },
      { goalId, status: "CANCELLED" },
      { goalId: "goal-2", status: "COMPLETED" },
    ]);
    expect(progress).toEqual({
      total: 5,
      pending: 1,
      running: 1,
      completed: 1,
      failed: 1,
      cancelled: 1,
      completedRatio: 0.2,
    });
  });

  it("returns zero progress when a mission has no linked assignments", () => {
    expect(computeMissionProgress("goal-empty", [])).toEqual({
      total: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      completedRatio: 0,
    });
  });
});

describe("unassignedTasks", () => {
  it("returns assignments without a goal as unassigned tasks", () => {
    const items = [
      { goalId: "goal-1", status: "PENDING" as const },
      { status: "PENDING" as const },
    ];
    expect(unassignedTasks(items)).toEqual([{ status: "PENDING" }]);
  });
});
