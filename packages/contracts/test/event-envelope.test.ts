import { describe, expect, it } from "vitest";

import { eventEnvelopeSchema } from "../src/schemas/event-envelope.js";

const validEnvelope = {
  schemaVersion: "1",
  eventId: "event-1",
  eventType: "run.started",
  occurredAt: "2026-09-15T03:18:00Z",
  workspaceId: "workspace-1",
  aggregateType: "run",
  aggregateId: "run-1",
  correlationId: "corr-1",
  causationId: null,
  payload: {},
};

describe("Event Envelope v1", () => {
  it("parses a valid envelope", () => {
    const parsed = eventEnvelopeSchema.parse(validEnvelope);
    expect(parsed.eventType).toBe("run.started");
    expect(parsed.causationId).toBeNull();
  });

  it("accepts a canonical UTC occurredAt ending in Z", () => {
    const parsed = eventEnvelopeSchema.parse({
      ...validEnvelope,
      occurredAt: "2026-09-15T03:18:00Z",
    });
    expect(parsed.occurredAt).toBe("2026-09-15T03:18:00Z");
  });

  it("rejects a numeric-offset occurredAt", () => {
    const parsed = eventEnvelopeSchema.safeParse({
      ...validEnvelope,
      occurredAt: "2026-09-15T08:48:00+05:30",
    });
    expect(parsed.success).toBe(false);
  });
});
