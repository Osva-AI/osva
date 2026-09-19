import type {
  JsonValue,
  WorkflowEventId,
  WorkflowNodeRunId,
  WorkflowRunId,
} from "@osva/contracts";
import { WorkflowEvent, armWorkflowWait } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryWorkflowEventRepository } from "../src/memory-workflow-event-repository.js";
import { MemoryWorkflowEventWaitResolutionRepository } from "../src/memory-workflow-event-wait-resolution-repository.js";
import { MemoryWorkflowRunRepository } from "../src/memory-workflow-run-repository.js";
import { MemoryWorkflowWaitRepository } from "../src/memory-workflow-wait-repository.js";
import { workspaceId } from "./fixtures.js";

const workflowRunId = "workflow-run-1" as WorkflowRunId;
const nodeRunId = "node-run-1" as WorkflowNodeRunId;
const runCreated = new Date("2026-01-01T10:00:00.000Z");
const armedAt = new Date("2026-01-01T10:05:00.000Z");
const timeoutMs = 55 * 60_000;

function eventWait(timeout?: number) {
  return armWorkflowWait({
    workspaceId,
    workflowRunId,
    workflowNodeRunId: nodeRunId,
    workflowRunCreatedAt: runCreated,
    armedAt,
    nodeInput: { orderId: "ord-1" },
    wait: {
      kind: "EVENT",
      source: "payments",
      eventType: "payment.completed",
      correlation: { kind: "LITERAL", value: "ord-1" },
      ...(timeout === undefined ? {} : { timeoutMs: timeout }),
    },
  });
}

function event(
  id: string,
  receivedAt: Date,
  overrides: Partial<{
    occurredAt: Date;
  }> = {},
) {
  return {
    id: id as WorkflowEventId,
    workspaceId,
    source: "payments",
    eventType: "payment.completed",
    correlationKey: "ord-1",
    idempotencyKey: `idem-${id}`,
    payload: { ok: true } as JsonValue,
    receivedAt,
    ...overrides,
  };
}

describe("MemoryWorkflowEventWaitResolutionRepository", () => {
  async function setup() {
    const events = new MemoryWorkflowEventRepository();
    const workflowRuns = new MemoryWorkflowRunRepository();
    const waits = new MemoryWorkflowWaitRepository(events, workflowRuns);
    const resolution = new MemoryWorkflowEventWaitResolutionRepository(
      waits,
      events,
      workflowRuns,
    );
    return { events, waits, resolution, workflowRuns };
  }

  it("resolves an eligible event as EVENT", async () => {
    const { events, waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));
    await events.saveWorkflowEvent(
      WorkflowEvent.create(event("e1", new Date("2026-01-01T10:30:00.000Z"))),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolution).toBe("EVENT");
    expect(resolved.resolvedByEventId).toBe("e1");
  });

  it("selects earliest receivedAt", async () => {
    const { events, waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));
    await events.saveWorkflowEvent(
      WorkflowEvent.create(
        event("e-late", new Date("2026-01-01T10:40:00.000Z")),
      ),
    );
    await events.saveWorkflowEvent(
      WorkflowEvent.create(
        event("e-early", new Date("2026-01-01T10:20:00.000Z")),
      ),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolvedByEventId).toBe("e-early");
  });

  it("breaks equal receivedAt ties by WorkflowEventId", async () => {
    const { events, waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));
    const at = new Date("2026-01-01T10:30:00.000Z");
    await events.saveWorkflowEvent(WorkflowEvent.create(event("e-b", at)));
    await events.saveWorkflowEvent(WorkflowEvent.create(event("e-a", at)));

    const resolved = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolvedByEventId).toBe("e-a");
  });

  it("keeps events received before arm eligible when after run creation", async () => {
    const { events, waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));
    await events.saveWorkflowEvent(
      WorkflowEvent.create(
        event("e-early", new Date("2026-01-01T10:01:00.000Z")),
      ),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolution).toBe("EVENT");
  });

  it("rejects events received after expiresAt", async () => {
    const { events, waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));
    await events.saveWorkflowEvent(
      WorkflowEvent.create(
        event("e-late", new Date("2026-01-01T11:01:00.000Z")),
      ),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolution).toBe("TIMEOUT");
  });

  it("ignores occurredAt when receivedAt is after expiresAt", async () => {
    const { events, waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));
    await events.saveWorkflowEvent(
      WorkflowEvent.create(
        event("e1", new Date("2026-01-01T11:01:00.000Z"), {
          occurredAt: new Date("2026-01-01T10:30:00.000Z"),
        }),
      ),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolution).toBe("TIMEOUT");
  });

  it("chooses EVENT when now is after expiresAt but durable event qualifies", async () => {
    const { events, waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));
    await events.saveWorkflowEvent(
      WorkflowEvent.create(event("e1", new Date("2026-01-01T10:59:00.000Z"))),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:05:00.000Z"),
    );
    expect(resolved.resolution).toBe("EVENT");
  });

  it("times out when no candidate and expiresAt is due", async () => {
    const { waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));

    const resolved = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolution).toBe("TIMEOUT");
  });

  it("returns PENDING when timeout is not due and no event", async () => {
    const { waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));

    const pending = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T10:30:00.000Z"),
    );
    expect(pending.resolution).toBeUndefined();
  });

  it("returns existing EVENT resolution idempotently", async () => {
    const { events, waits, resolution } = await setup();
    const active = eventWait(timeoutMs);
    await waits.saveWorkflowWait(active);
    const workflowEvent = WorkflowEvent.create(
      event("e1", new Date("2026-01-01T10:30:00.000Z")),
    );
    await events.saveWorkflowEvent(workflowEvent);
    const first = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    const second = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T12:00:00.000Z"),
    );
    expect(second).toEqual(first);
    expect(second.resolvedAt).toEqual(first.resolvedAt);
  });

  it("returns existing TIMEOUT resolution idempotently", async () => {
    const { waits, resolution } = await setup();
    await waits.saveWorkflowWait(eventWait(timeoutMs));
    const first = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    const second = await resolution.resolveWorkflowEventWait(
      nodeRunId,
      new Date("2026-01-01T12:00:00.000Z"),
    );
    expect(second.resolution).toBe("TIMEOUT");
    expect(second.resolvedAt).toEqual(first.resolvedAt);
  });
});
