import type { EventId, WorkspaceId } from "./ids.js";

export const EVENT_ENVELOPE_SCHEMA_VERSION = "1" as const;

export type EventEnvelopeSchemaVersion = typeof EVENT_ENVELOPE_SCHEMA_VERSION;

export interface EventEnvelopeV1 {
  readonly schemaVersion: EventEnvelopeSchemaVersion;
  readonly eventId: EventId;
  readonly eventType: string;
  /**
   * Canonical UTC ISO-8601 instant ending in `Z`.
   * Numeric time-zone offsets are not allowed.
   */
  readonly occurredAt: string;
  readonly workspaceId: WorkspaceId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId: EventId | null;
  readonly payload: Readonly<Record<string, unknown>>;
}
