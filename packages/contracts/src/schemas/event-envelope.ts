import { z } from "zod";

import { EVENT_ENVELOPE_SCHEMA_VERSION } from "../event-envelope.js";
import { eventIdSchema, workspaceIdSchema } from "./ids.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

export const eventEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(EVENT_ENVELOPE_SCHEMA_VERSION),
  eventId: eventIdSchema,
  eventType: z.string().min(1),
  occurredAt: utcIso8601TimestampSchema,
  workspaceId: workspaceIdSchema,
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.union([eventIdSchema, z.null()]),
  payload: z.record(z.string(), z.unknown()),
});
