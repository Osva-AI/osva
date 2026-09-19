import type {
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva/contracts";
import { WorkflowRun, armWorkflowWait } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryWorkflowEventRepository } from "../src/memory-workflow-event-repository.js";
import { MemoryWorkflowEventWaitResolutionRepository } from "../src/memory-workflow-event-wait-resolution-repository.js";
import { MemoryWorkflowRunRepository } from "../src/memory-workflow-run-repository.js";
import { MemoryWorkflowTimerWaitResolutionRepository } from "../src/memory-workflow-timer-wait-resolution-repository.js";
import { MemoryWorkflowWaitRepository } from "../src/memory-workflow-wait-repository.js";
import { workspaceId } from "./fixtures.js";

const workflowRunId = "workflow-run-1" as WorkflowRunId;
const nodeRunId = "node-run-1" as WorkflowNodeRunId;
const runCreated = new Date("2026-01-01T10:00:00.000Z");
const armedAt = new Date("2026-01-01T10:05:00.000Z");
const now = new Date("2026-01-01T11:00:00.000Z");

describe("terminal WorkflowRun wait guards", () => {
  async function seedRun(status: "SUCCEEDED" | "FAILED" | "CANCELLED") {
    const workflowRuns = new MemoryWorkflowRunRepository();
    const run = WorkflowRun.rehydrate({
      id: workflowRunId,
      workspaceId,
      workflowId: "wf-1" as WorkflowId,
      workflowVersionId: "wv-1" as WorkflowVersionId,
      status,
      input: {},
      createdAt: runCreated,
      updatedAt: now,
      completedAt: now,
    });
    await workflowRuns.saveWorkflowRun(run);
    return workflowRuns;
  }

  it("does not resolve TIMER waits for terminal workflow runs", async () => {
    const workflowRuns = await seedRun("SUCCEEDED");
    const waits = new MemoryWorkflowWaitRepository(undefined, workflowRuns);
    const timerResolution = new MemoryWorkflowTimerWaitResolutionRepository(
      waits,
      workflowRuns,
    );
    const timer = armWorkflowWait({
      workspaceId,
      workflowRunId,
      workflowNodeRunId: nodeRunId,
      workflowRunCreatedAt: runCreated,
      wait: { kind: "DURATION", durationMs: 1 },
      nodeInput: {},
      armedAt,
    });
    await waits.saveWorkflowWait(timer);

    const resolved = await timerResolution.resolveWorkflowTimerWait(
      nodeRunId,
      now,
    );
    expect(resolved.resolution).toBeUndefined();
    expect(await waits.listDueTimerWorkflowWaits(now, 10)).toHaveLength(0);
  });

  it("does not resolve EVENT waits for terminal workflow runs", async () => {
    const workflowRuns = await seedRun("FAILED");
    const events = new MemoryWorkflowEventRepository();
    const waits = new MemoryWorkflowWaitRepository(events, workflowRuns);
    const eventResolution = new MemoryWorkflowEventWaitResolutionRepository(
      waits,
      events,
      workflowRuns,
    );
    await waits.saveWorkflowWait(
      armWorkflowWait({
        workspaceId,
        workflowRunId,
        workflowNodeRunId: nodeRunId,
        workflowRunCreatedAt: runCreated,
        armedAt,
        nodeInput: {},
        wait: {
          kind: "EVENT",
          source: "billing",
          eventType: "invoice.paid",
          correlation: { kind: "LITERAL", value: "x" },
          timeoutMs: 1,
        },
      }),
    );

    const resolved = await eventResolution.resolveWorkflowEventWait(
      nodeRunId,
      now,
    );
    expect(resolved.resolution).toBeUndefined();
    expect(
      await waits.listActiveEventWorkflowWaitsByMatch({
        workspaceId,
        source: "billing",
        eventType: "invoice.paid",
        correlationKey: "x",
      }),
    ).toHaveLength(0);
  });
});
