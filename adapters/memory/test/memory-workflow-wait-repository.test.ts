import type { WorkflowNodeRunId, WorkflowRunId } from "@osva/contracts";
import {
  DomainInvariantError,
  WorkflowWaitNotFoundError,
  WorkflowWaitResolutionConflictError,
  armWorkflowWait,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryWorkflowWaitRepository } from "../src/memory-workflow-wait-repository.js";
import { workspaceId } from "./fixtures.js";

const workflowRunId = "workflow-run-1" as WorkflowRunId;
const otherWorkflowRunId = "workflow-run-2" as WorkflowRunId;
const nodeRunA = "node-run-a" as WorkflowNodeRunId;
const nodeRunB = "node-run-b" as WorkflowNodeRunId;
const nodeRunC = "node-run-c" as WorkflowNodeRunId;

const runCreated = new Date("2026-01-01T00:00:00.000Z");
const armedEarly = new Date("2026-01-01T01:00:00.000Z");
const armedLate = new Date("2026-01-01T02:00:00.000Z");
const resolvedAt = new Date("2026-01-01T02:30:00.000Z");

describe("MemoryWorkflowWaitRepository", () => {
  it("saves and loads WorkflowWait by workflowNodeRunId", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const timer = armTimer(nodeRunA, armedEarly);
    await waits.saveWorkflowWait(timer);

    expect(await waits.findWorkflowWaitByWorkflowNodeRunId(nodeRunA)).toBe(
      timer,
    );
    expect(
      await waits.findWorkflowWaitByWorkflowNodeRunId(nodeRunB),
    ).toBeNull();
  });

  it("rejects duplicate WorkflowNodeRunId", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    await waits.saveWorkflowWait(armTimer(nodeRunA, armedEarly));

    await expect(
      waits.saveWorkflowWait(armTimer(nodeRunA, armedLate)),
    ).rejects.toThrow(DomainInvariantError);
  });

  it("lists waits for one workflow run only", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    await waits.saveWorkflowWait(armTimer(nodeRunA, armedEarly, workflowRunId));
    await waits.saveWorkflowWait(armEvent(nodeRunB, armedLate, workflowRunId));
    await waits.saveWorkflowWait(
      armTimer(nodeRunC, armedEarly, otherWorkflowRunId),
    );

    const listed = await waits.listWorkflowWaitsByWorkflowRunId(workflowRunId);
    expect(listed.map((wait) => wait.workflowNodeRunId)).toEqual([
      nodeRunA,
      nodeRunB,
    ]);
  });

  it("orders waits by armedAt then workflowNodeRunId", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    await waits.saveWorkflowWait(armTimer(nodeRunB, armedLate, workflowRunId));
    await waits.saveWorkflowWait(armTimer(nodeRunA, armedEarly, workflowRunId));
    await waits.saveWorkflowWait(armEvent(nodeRunC, armedEarly, workflowRunId));

    const listed = await waits.listWorkflowWaitsByWorkflowRunId(workflowRunId);
    expect(listed.map((wait) => wait.workflowNodeRunId)).toEqual([
      nodeRunA,
      nodeRunC,
      nodeRunB,
    ]);
  });

  it("persists TIMER resolution from active wait", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const active = armTimer(nodeRunA, armedEarly);
    await waits.saveWorkflowWait(active);

    const resolved = await waits.saveWorkflowWaitResolution(
      active.resolveTimer(resolvedAt),
    );
    expect(resolved.resolution).toBe("TIMER");
    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeRunA))?.resolution,
    ).toBe("TIMER");
  });

  it("returns existing resolution on equivalent retry", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const active = armTimer(nodeRunA, armedEarly);
    await waits.saveWorkflowWait(active);
    const first = await waits.saveWorkflowWaitResolution(
      active.resolveTimer(resolvedAt),
    );
    const second = await waits.saveWorkflowWaitResolution(
      active.resolveTimer(new Date("2026-01-01T03:00:00.000Z")),
    );
    expect(second).toBe(first);
    expect(second.resolvedAt).toEqual(resolvedAt);
  });

  it("rejects conflicting resolution", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const active = armTimer(nodeRunA, armedEarly);
    await waits.saveWorkflowWait(active);
    await waits.saveWorkflowWaitResolution(active.resolveTimer(resolvedAt));

    await expect(
      waits.saveWorkflowWaitResolution(active.cancel(resolvedAt)),
    ).rejects.toBeInstanceOf(WorkflowWaitResolutionConflictError);
  });

  it("rejects resolution when wait is missing", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    await expect(
      waits.saveWorkflowWaitResolution(
        armTimer(nodeRunA, armedEarly).resolveTimer(resolvedAt),
      ),
    ).rejects.toBeInstanceOf(WorkflowWaitNotFoundError);
  });

  it("rejects unresolved WorkflowWait for resolution persistence", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const active = armTimer(nodeRunA, armedEarly);
    await waits.saveWorkflowWait(active);

    await expect(
      waits.saveWorkflowWaitResolution(active),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("stores immutable domain WorkflowWait objects", async () => {
    const waits = new MemoryWorkflowWaitRepository();
    const timer = armTimer(nodeRunA, armedEarly);
    await waits.saveWorkflowWait(timer);

    const loaded = await waits.findWorkflowWaitByWorkflowNodeRunId(nodeRunA);
    expect(loaded).toBe(timer);
    expect(Object.isFrozen(loaded)).toBe(true);
  });
});

function armTimer(
  workflowNodeRunId: WorkflowNodeRunId,
  armedAt: Date,
  workflowRun: WorkflowRunId = workflowRunId,
): ReturnType<typeof armWorkflowWait> {
  return armWorkflowWait({
    workspaceId,
    workflowRunId: workflowRun,
    workflowNodeRunId,
    workflowRunCreatedAt: runCreated,
    wait: { kind: "DURATION", durationMs: 60_000 },
    nodeInput: {},
    armedAt,
  });
}

function armEvent(
  workflowNodeRunId: WorkflowNodeRunId,
  armedAt: Date,
  workflowRun: WorkflowRunId = workflowRunId,
): ReturnType<typeof armWorkflowWait> {
  return armWorkflowWait({
    workspaceId,
    workflowRunId: workflowRun,
    workflowNodeRunId,
    workflowRunCreatedAt: runCreated,
    wait: {
      kind: "EVENT",
      source: "billing",
      eventType: "invoice.paid",
      correlation: { kind: "LITERAL", value: "corr-1" },
    },
    nodeInput: {},
    armedAt,
  });
}
