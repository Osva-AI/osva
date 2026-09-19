import type { JsonValue, WorkflowEventId } from "@osva/contracts";
import {
  DomainInvariantError,
  WorkflowEvent,
  WorkflowEventIdempotencyConflictError,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryWorkflowEventRepository } from "../src/memory-workflow-event-repository.js";
import { otherWorkspaceId, workspaceId } from "./fixtures.js";

const eventId = "we-1" as WorkflowEventId;
const otherEventId = "we-2" as WorkflowEventId;
const thirdEventId = "we-3" as WorkflowEventId;
const receivedAt = new Date("2026-01-01T12:00:00.000Z");
const laterReceivedAt = new Date("2026-01-01T12:00:01.000Z");
const payload: JsonValue = { a: 1 };

describe("MemoryWorkflowEventRepository", () => {
  it("saves and loads by WorkflowEventId", async () => {
    const events = new MemoryWorkflowEventRepository();
    const created = createEvent();
    await events.saveWorkflowEvent(created);

    expect(await events.findWorkflowEventById(eventId)).toBe(created);
    expect(await events.findWorkflowEventById(otherEventId)).toBeNull();
  });

  it("finds by workspaceId + source + idempotencyKey", async () => {
    const events = new MemoryWorkflowEventRepository();
    const created = createEvent();
    await events.saveWorkflowEvent(created);

    expect(
      await events.findWorkflowEventByIngestionIdentity(
        workspaceId,
        "payments",
        "idem-1",
      ),
    ).toBe(created);
    expect(
      await events.findWorkflowEventByIngestionIdentity(
        workspaceId,
        "payments",
        "missing",
      ),
    ).toBeNull();
  });

  it("returns the original persisted event on equivalent retry", async () => {
    const events = new MemoryWorkflowEventRepository();
    const created = createEvent();
    await events.saveWorkflowEvent(created);

    const retried = await events.saveWorkflowEvent(
      createEvent({
        id: otherEventId,
        receivedAt: laterReceivedAt,
      }),
    );

    expect(retried).toBe(created);
    expect(retried.id).toBe(eventId);
    expect(retried.receivedAt).toEqual(receivedAt);
    expect(await events.findWorkflowEventById(otherEventId)).toBeNull();
  });

  it("throws WorkflowEventIdempotencyConflictError on conflicting retry", async () => {
    const events = new MemoryWorkflowEventRepository();
    await events.saveWorkflowEvent(createEvent());

    await expect(
      events.saveWorkflowEvent(
        createEvent({
          id: otherEventId,
          eventType: "payment.failed",
        }),
      ),
    ).rejects.toBeInstanceOf(WorkflowEventIdempotencyConflictError);
  });

  it("scopes idempotency by source", async () => {
    const events = new MemoryWorkflowEventRepository();
    await events.saveWorkflowEvent(createEvent());

    const otherSource = await events.saveWorkflowEvent(
      createEvent({
        id: otherEventId,
        source: "ledger",
      }),
    );
    expect(otherSource.id).toBe(otherEventId);
  });

  it("scopes idempotency by workspace", async () => {
    const events = new MemoryWorkflowEventRepository();
    await events.saveWorkflowEvent(createEvent());

    const otherWorkspace = await events.saveWorkflowEvent(
      createEvent({
        id: otherEventId,
        workspaceId: otherWorkspaceId,
      }),
    );
    expect(otherWorkspace.workspaceId).toBe(otherWorkspaceId);
  });

  it("rejects duplicate WorkflowEventId under a different ingestion identity", async () => {
    const events = new MemoryWorkflowEventRepository();
    await events.saveWorkflowEvent(createEvent());

    await expect(
      events.saveWorkflowEvent(
        createEvent({
          source: "ledger",
          idempotencyKey: "idem-ledger",
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("allows equivalent retry when the same WorkflowEventId is reused", async () => {
    const events = new MemoryWorkflowEventRepository();
    const created = createEvent();
    await events.saveWorkflowEvent(created);

    const retried = await events.saveWorkflowEvent(createEvent());
    expect(retried).toBe(created);
  });

  it("does not collide ingestion keys that share delimiter-like prefixes", async () => {
    const events = new MemoryWorkflowEventRepository();
    await events.saveWorkflowEvent(
      createEvent({
        id: eventId,
        source: "a:b",
        idempotencyKey: "c",
      }),
    );

    const independent = await events.saveWorkflowEvent(
      createEvent({
        id: otherEventId,
        source: "a",
        idempotencyKey: "b:c",
      }),
    );
    expect(independent.id).toBe(otherEventId);
  });

  it("returns null for missing lookups", async () => {
    const events = new MemoryWorkflowEventRepository();
    expect(await events.findWorkflowEventById(thirdEventId)).toBeNull();
    expect(
      await events.findWorkflowEventByIngestionIdentity(
        workspaceId,
        "payments",
        "missing",
      ),
    ).toBeNull();
  });
});

function createEvent(
  overrides: Partial<Parameters<typeof WorkflowEvent.create>[0]> = {},
): WorkflowEvent {
  return WorkflowEvent.create({
    id: eventId,
    workspaceId,
    source: "payments",
    eventType: "payment.completed",
    correlationKey: "order_123",
    idempotencyKey: "idem-1",
    payload,
    receivedAt,
    ...overrides,
  });
}
