import type { WorkflowNodeRunId, WorkflowRunId } from "@osva/contracts";
import {
  MemoryWorkflowRunRepository,
  MemoryWorkflowTimerWaitResolutionRepository,
  MemoryWorkflowWaitRepository,
} from "@osva/adapters-memory";
import { DomainInvariantError, armWorkflowWait } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { ProcessDueTimerWaits } from "../src/process-due-timer-waits.js";
import { workspaceId } from "./fixtures.js";

const workflowRunId = "workflow-run-1" as WorkflowRunId;
const nodeA = "node-run-a" as WorkflowNodeRunId;
const nodeB = "node-run-b" as WorkflowNodeRunId;
const nodeC = "node-run-c" as WorkflowNodeRunId;
const nodeEvent = "node-run-event" as WorkflowNodeRunId;

const runCreated = new Date("2026-01-01T00:00:00.000Z");
const armedAt = new Date("2026-01-01T01:00:00.000Z");
const futureWake = new Date("2026-01-01T06:00:00.000Z");
const dueNow = new Date("2026-01-01T05:00:00.000Z");

describe("ProcessDueTimerWaits", () => {
  it("resolves due TIMER waits", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const processor = createProcessor(waits);
    await waits.saveWorkflowWait(armDuration(nodeA, armedAt));

    const resolved = await processor.execute(dueNow, 10);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.resolution).toBe("TIMER");
  });

  it("leaves future TIMER waits active", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const processor = createProcessor(waits);
    await waits.saveWorkflowWait(
      armUntil(nodeB, armedAt, futureWake.toISOString()),
    );

    const resolved = await processor.execute(dueNow, 10);
    expect(resolved).toHaveLength(0);
    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeB))?.resolution,
    ).toBeUndefined();
  });

  it("processes due TIMER waits in deterministic order", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const processor = createProcessor(waits);
    await waits.saveWorkflowWait(
      armUntil(nodeB, armedAt, "2026-01-01T03:00:00.000Z"),
    );
    await waits.saveWorkflowWait(
      armUntil(nodeA, armedAt, "2026-01-01T02:00:00.000Z"),
    );

    const resolved = await processor.execute(dueNow, 10);
    expect(resolved.map((wait) => wait.workflowNodeRunId)).toEqual([
      nodeA,
      nodeB,
    ]);
  });

  it("respects the processing limit", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const processor = createProcessor(waits);
    await waits.saveWorkflowWait(armDuration(nodeA, armedAt));
    await waits.saveWorkflowWait(armDuration(nodeB, armedAt));
    await waits.saveWorkflowWait(armDuration(nodeC, armedAt));

    const resolved = await processor.execute(dueNow, 2);
    expect(resolved).toHaveLength(2);
  });

  it("ignores already resolved TIMER waits", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const processor = createProcessor(waits);
    const active = armDuration(nodeA, armedAt);
    await waits.saveWorkflowWait(active.resolveTimer(dueNow));

    const resolved = await processor.execute(dueNow, 10);
    expect(resolved).toHaveLength(0);
  });

  it("ignores EVENT waits", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const processor = createProcessor(waits);
    await waits.saveWorkflowWait(
      armWorkflowWait({
        workspaceId,
        workflowRunId,
        workflowNodeRunId: nodeEvent,
        workflowRunCreatedAt: runCreated,
        wait: {
          kind: "EVENT",
          source: "billing",
          eventType: "invoice.paid",
          correlation: { kind: "LITERAL", value: "corr-1" },
        },
        nodeInput: {},
        armedAt,
      }),
    );

    const resolved = await processor.execute(dueNow, 10);
    expect(resolved).toHaveLength(0);
  });

  it("resolves UNTIL timers whose wakeAt is before armedAt", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const processor = createProcessor(waits);
    const lateArmed = new Date("2026-01-01T03:00:00.000Z");
    await waits.saveWorkflowWait(
      armUntil(nodeA, lateArmed, "2026-01-01T02:00:00.000Z"),
    );

    const resolved = await processor.execute(dueNow, 10);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.resolution).toBe("TIMER");
  });

  it("rejects non-positive limits", async () => {
    const processor = createProcessor(new MemoryWorkflowWaitRepository());
    await expect(processor.execute(dueNow, 0)).rejects.toBeInstanceOf(
      DomainInvariantError,
    );
  });
});

function createProcessor(waits: MemoryWorkflowWaitRepository) {
  const runs = new MemoryWorkflowRunRepository();
  const timerWaitResolution = new MemoryWorkflowTimerWaitResolutionRepository(
    waits,
    runs,
  );
  return new ProcessDueTimerWaits({
    workflowWaits: waits,
    timerWaitResolution,
  });
}

function armDuration(
  workflowNodeRunId: WorkflowNodeRunId,
  armed: Date,
): ReturnType<typeof armWorkflowWait> {
  return armWorkflowWait({
    workspaceId,
    workflowRunId,
    workflowNodeRunId,
    workflowRunCreatedAt: runCreated,
    wait: { kind: "DURATION", durationMs: 60_000 },
    nodeInput: {},
    armedAt: armed,
  });
}

function armUntil(
  workflowNodeRunId: WorkflowNodeRunId,
  armed: Date,
  until: string,
): ReturnType<typeof armWorkflowWait> {
  return armWorkflowWait({
    workspaceId,
    workflowRunId,
    workflowNodeRunId,
    workflowRunCreatedAt: runCreated,
    wait: { kind: "UNTIL", until },
    nodeInput: {},
    armedAt: armed,
  });
}
