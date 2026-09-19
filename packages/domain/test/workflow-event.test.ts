import type { JsonValue, WorkflowEventId, WorkspaceId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  DomainInvariantError,
  WorkflowEventIdempotencyConflictError,
} from "../src/errors.js";
import {
  WorkflowEvent,
  assertWorkflowEventEquivalentRetry,
  hasWorkflowEventIngestionIdentity,
  isEquivalentWorkflowEventRetry,
  type WorkflowEventSubmission,
} from "../src/workflow-event.js";

const workspaceId = "ws-1" as WorkspaceId;
const otherWorkspaceId = "ws-2" as WorkspaceId;
const eventId = "we-1" as WorkflowEventId;
const receivedAt = new Date("2026-01-01T12:00:00.000Z");
const payload: JsonValue = { a: 1, b: 2 };

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

function submission(
  overrides: Partial<WorkflowEventSubmission> = {},
): WorkflowEventSubmission {
  return {
    workspaceId,
    source: "payments",
    eventType: "payment.completed",
    correlationKey: "order_123",
    idempotencyKey: "idem-1",
    payload,
    ...overrides,
  };
}

describe("WorkflowEvent creation", () => {
  it("creates a valid immutable event with copied dates and payload", () => {
    const occurredAt = new Date("2026-01-01T11:00:00.000Z");
    const event = createEvent({ occurredAt });
    expect(event.id).toBe(eventId);
    expect(event.source).toBe("payments");
    expect(event.correlationKey).toBe("order_123");
    expect(event.receivedAt.toISOString()).toBe(receivedAt.toISOString());
    expect(event.occurredAt?.toISOString()).toBe(occurredAt.toISOString());
    expect(event.receivedAt).not.toBe(receivedAt);
    expect(event.occurredAt).not.toBe(occurredAt);
    expect(event.payload).toEqual({ a: 1, b: 2 });
    expect(event.payload).not.toBe(payload);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it("rejects invalid identity fields and payload", () => {
    expect(() => createEvent({ id: "" as WorkflowEventId })).toThrow(
      DomainInvariantError,
    );
    expect(() => createEvent({ source: "" })).toThrow(DomainInvariantError);
    expect(() => createEvent({ eventType: "" })).toThrow(DomainInvariantError);
    expect(() => createEvent({ correlationKey: "" })).toThrow(
      DomainInvariantError,
    );
    expect(() => createEvent({ idempotencyKey: "" })).toThrow(
      DomainInvariantError,
    );
    expect(() => createEvent({ receivedAt: new Date("invalid") })).toThrow(
      DomainInvariantError,
    );
    expect(() => createEvent({ occurredAt: new Date("invalid") })).toThrow(
      DomainInvariantError,
    );
    expect(() => createEvent({ payload: () => undefined })).toThrow(
      DomainInvariantError,
    );
  });

  it("allows occurredAt after receivedAt", () => {
    const event = createEvent({
      occurredAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(event.occurredAt!.getTime()).toBeGreaterThan(
      event.receivedAt.getTime(),
    );
  });
});

describe("WorkflowEvent ingestion identity", () => {
  it("scopes identity to workspaceId + source + idempotencyKey", () => {
    const event = createEvent();
    expect(hasWorkflowEventIngestionIdentity(event, submission())).toBe(true);
    expect(
      hasWorkflowEventIngestionIdentity(
        event,
        submission({ source: "shopify" }),
      ),
    ).toBe(false);
    expect(
      hasWorkflowEventIngestionIdentity(
        event,
        submission({ workspaceId: otherWorkspaceId }),
      ),
    ).toBe(false);
  });
});

describe("WorkflowEvent.rehydrate", () => {
  it("rehydrates persisted fields exactly with defensive copies", () => {
    const occurredAt = new Date("2026-01-01T11:00:00.000Z");
    const created = createEvent({ occurredAt });
    const rehydrated = WorkflowEvent.rehydrate({
      id: created.id,
      workspaceId: created.workspaceId,
      source: created.source,
      eventType: created.eventType,
      correlationKey: created.correlationKey,
      idempotencyKey: created.idempotencyKey,
      payload: created.payload,
      occurredAt: created.occurredAt,
      receivedAt: created.receivedAt,
    });
    expect(rehydrated.id).toBe(created.id);
    expect(rehydrated.receivedAt.toISOString()).toBe(
      created.receivedAt.toISOString(),
    );
    expect(rehydrated.receivedAt).not.toBe(created.receivedAt);
    expect(rehydrated.payload).toEqual(created.payload);
    expect(rehydrated.payload).not.toBe(created.payload);
    expect(Object.isFrozen(rehydrated)).toBe(true);
  });

  it("rejects invalid persisted dates", () => {
    expect(() =>
      WorkflowEvent.rehydrate({
        id: eventId,
        workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "order_123",
        idempotencyKey: "idem-1",
        payload,
        receivedAt: new Date("invalid"),
      }),
    ).toThrow(DomainInvariantError);
  });
});

describe("WorkflowEvent equivalent retry", () => {
  it("treats identical semantic submissions as equivalent", () => {
    const existing = createEvent({
      occurredAt: new Date("2026-01-01T10:00:00.000Z"),
    });
    expect(
      isEquivalentWorkflowEventRetry(
        existing,
        submission({
          occurredAt: new Date("2026-01-01T10:00:00.000Z"),
        }),
      ),
    ).toBe(true);

    const noOccurred = createEvent();
    expect(isEquivalentWorkflowEventRetry(noOccurred, submission())).toBe(true);
    expect(
      isEquivalentWorkflowEventRetry(
        existing,
        submission({ occurredAt: undefined }),
      ),
    ).toBe(false);
  });

  it("ignores WorkflowEventId and retry receivedAt", () => {
    const existing = createEvent({ id: "we-a" as WorkflowEventId });
    expect(isEquivalentWorkflowEventRetry(existing, submission())).toBe(true);
  });

  it("compares JSON payloads structurally", () => {
    const existing = createEvent({ payload: { a: 1, b: 2 } });
    expect(
      isEquivalentWorkflowEventRetry(
        existing,
        submission({ payload: { b: 2, a: 1 } }),
      ),
    ).toBe(true);
    expect(
      isEquivalentWorkflowEventRetry(
        existing,
        submission({ payload: { a: 1, b: [2] } }),
      ),
    ).toBe(false);
    expect(
      isEquivalentWorkflowEventRetry(
        existing,
        submission({ payload: { a: 1, b: 3 } }),
      ),
    ).toBe(false);
  });

  it("detects semantic conflicts", () => {
    const existing = createEvent();
    expect(
      isEquivalentWorkflowEventRetry(
        existing,
        submission({ eventType: "payment.failed" }),
      ),
    ).toBe(false);
    expect(
      isEquivalentWorkflowEventRetry(
        existing,
        submission({ correlationKey: "other" }),
      ),
    ).toBe(false);
    expect(
      isEquivalentWorkflowEventRetry(
        existing,
        submission({ payload: { changed: true } }),
      ),
    ).toBe(false);
    expect(
      isEquivalentWorkflowEventRetry(
        existing,
        submission({ occurredAt: new Date("2026-01-01T09:00:00.000Z") }),
      ),
    ).toBe(false);
  });

  it("throws WorkflowEventIdempotencyConflictError on conflict", () => {
    const existing = createEvent();
    expect(() =>
      assertWorkflowEventEquivalentRetry(
        existing,
        submission({ eventType: "payment.failed" }),
      ),
    ).toThrow(WorkflowEventIdempotencyConflictError);
    expect(() =>
      assertWorkflowEventEquivalentRetry(existing, submission()),
    ).not.toThrow();
  });
});
