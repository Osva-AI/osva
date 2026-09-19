import { describe, expect, it, vi } from "vitest";
import type {
  ReconcileWorkflowRunIds,
  WorkflowOrchestratorTick,
  WorkflowWaitDriverTick,
} from "@osva/orchestration";

import { runWorkflowOrchestratorPipeline } from "../src/tick-pipeline.js";

describe("runWorkflowOrchestratorPipeline", () => {
  it("runs the wait driver before workflow reconciliation with one clock instant", async () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const order: string[] = [];
    const waitDriver = {
      execute: vi.fn(async (instant: Date) => {
        order.push(`wait:${instant.toISOString()}`);
      }),
    };
    const workflowTick = {
      execute: vi.fn(async (instant: Date) => {
        order.push(`workflow:${instant.toISOString()}`);
      }),
    };
    const ids = {} as ReconcileWorkflowRunIds;

    await runWorkflowOrchestratorPipeline({
      now,
      waitDriver: waitDriver as unknown as WorkflowWaitDriverTick,
      workflowTick: workflowTick as unknown as WorkflowOrchestratorTick,
      ids,
    });

    expect(order).toEqual([
      `wait:${now.toISOString()}`,
      `workflow:${now.toISOString()}`,
    ]);
  });
});
