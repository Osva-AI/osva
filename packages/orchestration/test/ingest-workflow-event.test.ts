import type {
  JsonValue,
  WorkflowEventId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  MemoryWorkflowEventRepository,
  MemoryWorkflowEventWaitResolutionRepository,
  MemoryWorkflowRunRepository,
  MemoryWorkflowWaitRepository,
} from "@osva/adapters-memory";
import {
  WorkflowEvent,
  WorkflowEventIdempotencyConflictError,
  armWorkflowWait,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { IngestWorkflowEvent } from "../src/ingest-workflow-event.js";
import { otherWorkspaceId, workspaceId } from "./fixtures.js";

const workflowRunId = "workflow-run-1" as WorkflowRunId;
const nodeA = "node-run-a" as WorkflowNodeRunId;
const nodeB = "node-run-b" as WorkflowNodeRunId;
const runCreated = new Date("2026-01-01T10:00:00.000Z");
const armedAt = new Date("2026-01-01T10:05:00.000Z");
const timeoutMs = 55 * 60_000;
const now = new Date("2026-01-01T11:30:00.000Z");

function setupIngest() {
  const events = new MemoryWorkflowEventRepository();
  const workflowRuns = new MemoryWorkflowRunRepository();
  const waits = new MemoryWorkflowWaitRepository(events, workflowRuns);
  const resolution = new MemoryWorkflowEventWaitResolutionRepository(
    waits,
    events,
    workflowRuns,
  );
  const ingest = new IngestWorkflowEvent({
    workflowEvents: events,
    workflowWaits: waits,
    eventWaitResolution: resolution,
  });
  return { events, waits, ingest };
}

function eventWait(
  workflowNodeRunId: WorkflowNodeRunId,
  correlation = "ord-1",
  timeout?: number,
) {
  return armWorkflowWait({
    workspaceId,
    workflowRunId,
    workflowNodeRunId,
    workflowRunCreatedAt: runCreated,
    armedAt,
    nodeInput: { orderId: correlation },
    wait: {
      kind: "EVENT",
      source: "payments",
      eventType: "payment.completed",
      correlation: { kind: "LITERAL", value: correlation },
      ...(timeout === undefined ? {} : { timeoutMs: timeout }),
    },
  });
}

function submission(
  overrides: Partial<{
    source: string;
    eventType: string;
    correlationKey: string;
    workspaceId: WorkspaceId;
    idempotencyKey: string;
  }> = {},
) {
  return {
    workspaceId: overrides.workspaceId ?? workspaceId,
    source: overrides.source ?? "payments",
    eventType: overrides.eventType ?? "payment.completed",
    correlationKey: overrides.correlationKey ?? "ord-1",
    idempotencyKey: overrides.idempotencyKey ?? "idem-1",
    payload: { ok: true } as JsonValue,
  };
}

describe("IngestWorkflowEvent", () => {
  it("persists a new event", async () => {
    const { events, ingest } = setupIngest();
    const persisted = await ingest.execute({
      submission: submission(),
      eventId: "evt-1" as WorkflowEventId,
      now,
    });
    expect(await events.findWorkflowEventById("evt-1" as WorkflowEventId)).toBe(
      persisted,
    );
  });

  it("persists when no matching waits exist", async () => {
    const { ingest } = setupIngest();
    const persisted = await ingest.execute({
      submission: submission({ correlationKey: "missing" }),
      eventId: "evt-2" as WorkflowEventId,
      now,
    });
    expect(persisted.correlationKey).toBe("missing");
  });

  it("resolves exact matching waits", async () => {
    const { waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA));

    await ingest.execute({
      submission: submission(),
      eventId: "evt-3" as WorkflowEventId,
      now,
    });

    const resolved = await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA);
    expect(resolved?.resolution).toBe("EVENT");
  });

  it("ignores source mismatch", async () => {
    const { waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA));

    await ingest.execute({
      submission: submission({ source: "ledger" }),
      eventId: "evt-4" as WorkflowEventId,
      now,
    });

    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA))?.resolution,
    ).toBeUndefined();
  });

  it("ignores event type mismatch", async () => {
    const { waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA));

    await ingest.execute({
      submission: submission({ eventType: "payment.failed" }),
      eventId: "evt-5" as WorkflowEventId,
      now,
    });

    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA))?.resolution,
    ).toBeUndefined();
  });

  it("ignores correlation mismatch", async () => {
    const { waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA));

    await ingest.execute({
      submission: submission({ correlationKey: "other" }),
      eventId: "evt-6" as WorkflowEventId,
      now,
    });

    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA))?.resolution,
    ).toBeUndefined();
  });

  it("scopes matching by workspace", async () => {
    const { waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA));

    await ingest.execute({
      submission: submission({ workspaceId: otherWorkspaceId }),
      eventId: "evt-7" as WorkflowEventId,
      now,
    });

    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA))?.resolution,
    ).toBeUndefined();
  });

  it("resolves multiple matching waits from one event", async () => {
    const { waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA));
    await waits.saveWorkflowWait(eventWait(nodeB));

    await ingest.execute({
      submission: submission(),
      eventId: "evt-8" as WorkflowEventId,
      now,
    });

    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA))?.resolution,
    ).toBe("EVENT");
    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeB))?.resolution,
    ).toBe("EVENT");
  });

  it("does not resolve when receivedAt is after expiresAt", async () => {
    const { waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA, "ord-1", timeoutMs));

    await ingest.execute({
      submission: submission(),
      eventId: "evt-9" as WorkflowEventId,
      now: new Date("2026-01-01T11:01:00.000Z"),
    });

    const wait = await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA);
    expect(wait?.resolution).toBe("TIMEOUT");
  });

  it("can resolve after arm when event was eligible from run creation", async () => {
    const { waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA));

    await ingest.execute({
      submission: submission(),
      eventId: "evt-10" as WorkflowEventId,
      now: new Date("2026-01-01T10:06:00.000Z"),
    });

    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA))?.resolution,
    ).toBe("EVENT");
  });

  it("reattempts matching on idempotent ingest retry", async () => {
    const { waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA));

    await ingest.execute({
      submission: submission(),
      eventId: "evt-11" as WorkflowEventId,
      now,
    });
    await ingest.execute({
      submission: submission(),
      eventId: "evt-11-retry" as WorkflowEventId,
      now,
    });

    expect(
      (await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA))?.resolution,
    ).toBe("EVENT");
  });

  it("prefers older durable candidate over newly ingested event", async () => {
    const { events, waits, ingest } = setupIngest();
    await waits.saveWorkflowWait(eventWait(nodeA));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-old" as WorkflowEventId,
        workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-old",
        payload: { ok: true },
        receivedAt: new Date("2026-01-01T10:20:00.000Z"),
      }),
    );

    await ingest.execute({
      submission: submission({ idempotencyKey: "idem-new" }),
      eventId: "evt-new" as WorkflowEventId,
      now,
    });

    const resolved = await waits.findWorkflowWaitByWorkflowNodeRunId(nodeA);
    expect(resolved?.resolvedByEventId).toBe("evt-old");
  });

  it("rejects conflicting idempotent retry", async () => {
    const { ingest } = setupIngest();
    await ingest.execute({
      submission: submission(),
      eventId: "evt-12" as WorkflowEventId,
      now,
    });

    await expect(
      ingest.execute({
        submission: submission({ eventType: "payment.failed" }),
        eventId: "evt-12b" as WorkflowEventId,
        now,
      }),
    ).rejects.toBeInstanceOf(WorkflowEventIdempotencyConflictError);
  });
});
