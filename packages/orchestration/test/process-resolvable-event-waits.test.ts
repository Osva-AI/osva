import type {
  WorkflowEventId,
  WorkflowNodeRunId,
  WorkflowRunId,
} from "@osva/contracts";
import {
  MemoryWorkflowEventRepository,
  MemoryWorkflowEventWaitResolutionRepository,
  MemoryWorkflowRunRepository,
  MemoryWorkflowWaitRepository,
} from "@osva/adapters-memory";
import { WorkflowEvent, armWorkflowWait } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { ProcessResolvableEventWaits } from "../src/process-resolvable-event-waits.js";
import { workspaceId } from "./fixtures.js";

const workflowRunId = "workflow-run-1" as WorkflowRunId;
const nodeA = "node-run-a" as WorkflowNodeRunId;
const nodeB = "node-run-b" as WorkflowNodeRunId;
const runCreated = new Date("2026-01-01T10:00:00.000Z");
const armedAt = new Date("2026-01-01T10:05:00.000Z");
const timeoutMs = 55 * 60_000;

function setupProcessor() {
  const events = new MemoryWorkflowEventRepository();
  const workflowRuns = new MemoryWorkflowRunRepository();
  const waits = new MemoryWorkflowWaitRepository(events, workflowRuns);
  const resolution = new MemoryWorkflowEventWaitResolutionRepository(
    waits,
    events,
    workflowRuns,
  );
  const processor = new ProcessResolvableEventWaits({
    workflowWaits: waits,
    eventWaitResolution: resolution,
  });
  return { events, waits, processor };
}

function eventWait(workflowNodeRunId: WorkflowNodeRunId, timeout?: number) {
  return armWorkflowWait({
    workspaceId,
    workflowRunId,
    workflowNodeRunId,
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

describe("ProcessResolvableEventWaits", () => {
  it("recovers scenario F: persisted event without ingest matching", async () => {
    const { events, waits, processor } = setupProcessor();
    await waits.saveWorkflowWait(eventWait(nodeA));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-f" as WorkflowEventId,
        workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-f",
        payload: { ok: true },
        receivedAt: new Date("2026-01-01T10:30:00.000Z"),
      }),
    );

    const resolved = await processor.execute(
      new Date("2026-01-01T11:30:00.000Z"),
      10,
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.resolution).toBe("EVENT");
  });

  it("resolves no-timeout waits when eligible event exists", async () => {
    const { events, waits, processor } = setupProcessor();
    await waits.saveWorkflowWait(eventWait(nodeA, undefined));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-nt" as WorkflowEventId,
        workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-nt",
        payload: {},
        receivedAt: new Date("2026-01-01T10:30:00.000Z"),
      }),
    );

    const resolved = await processor.execute(
      new Date("2026-01-01T10:40:00.000Z"),
      10,
    );
    expect(resolved[0]!.resolution).toBe("EVENT");
  });

  it("times out when no event and expiresAt is due", async () => {
    const { waits, processor } = setupProcessor();
    await waits.saveWorkflowWait(eventWait(nodeA, timeoutMs));

    const resolved = await processor.execute(
      new Date("2026-01-01T11:30:00.000Z"),
      10,
    );
    expect(resolved[0]!.resolution).toBe("TIMEOUT");
  });

  it("prefers EVENT over TIMEOUT when durable event qualifies", async () => {
    const { events, waits, processor } = setupProcessor();
    await waits.saveWorkflowWait(eventWait(nodeA, timeoutMs));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-win" as WorkflowEventId,
        workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-win",
        payload: {},
        receivedAt: new Date("2026-01-01T10:59:00.000Z"),
      }),
    );

    const resolved = await processor.execute(
      new Date("2026-01-01T11:05:00.000Z"),
      10,
    );
    expect(resolved[0]!.resolution).toBe("EVENT");
  });

  it("times out when only late events exist", async () => {
    const { events, waits, processor } = setupProcessor();
    await waits.saveWorkflowWait(eventWait(nodeA, timeoutMs));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-late" as WorkflowEventId,
        workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-late",
        payload: {},
        receivedAt: new Date("2026-01-01T11:01:00.000Z"),
      }),
    );

    const resolved = await processor.execute(
      new Date("2026-01-01T11:30:00.000Z"),
      10,
    );
    expect(resolved[0]!.resolution).toBe("TIMEOUT");
  });

  it("ignores non-due waits without eligible events", async () => {
    const { waits, processor } = setupProcessor();
    await waits.saveWorkflowWait(eventWait(nodeA, timeoutMs));

    const resolved = await processor.execute(
      new Date("2026-01-01T10:30:00.000Z"),
      10,
    );
    expect(resolved).toHaveLength(0);
  });

  it("respects limit", async () => {
    const { events, waits, processor } = setupProcessor();
    await waits.saveWorkflowWait(eventWait(nodeA, timeoutMs));
    await waits.saveWorkflowWait(eventWait(nodeB, timeoutMs));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-lim" as WorkflowEventId,
        workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-lim",
        payload: {},
        receivedAt: new Date("2026-01-01T10:30:00.000Z"),
      }),
    );

    const resolved = await processor.execute(
      new Date("2026-01-01T11:30:00.000Z"),
      1,
    );
    expect(resolved).toHaveLength(1);
  });

  it("is idempotent on repeated recovery", async () => {
    const { events, waits, processor } = setupProcessor();
    await waits.saveWorkflowWait(eventWait(nodeA));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-repeat" as WorkflowEventId,
        workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-repeat",
        payload: {},
        receivedAt: new Date("2026-01-01T10:30:00.000Z"),
      }),
    );

    await processor.execute(new Date("2026-01-01T11:30:00.000Z"), 10);
    expect(
      await processor.execute(new Date("2026-01-01T11:30:00.000Z"), 10),
    ).toHaveLength(0);
  });

  it("handles concurrent recovery without conflicting resolution", async () => {
    const { events, waits, processor } = setupProcessor();
    await waits.saveWorkflowWait(eventWait(nodeA));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-conc" as WorkflowEventId,
        workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-conc",
        payload: {},
        receivedAt: new Date("2026-01-01T10:30:00.000Z"),
      }),
    );

    const now = new Date("2026-01-01T11:30:00.000Z");
    await Promise.all([processor.execute(now, 10), processor.execute(now, 10)]);

    const stored = await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA);
    expect(stored?.resolution).toBe("EVENT");
  });
});
