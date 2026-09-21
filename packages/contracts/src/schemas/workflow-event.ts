import { z } from "zod";

import {
  WORKFLOW_EVENT_CORRELATION_KEY_MAX_LENGTH,
  WORKFLOW_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH,
  WORKFLOW_EVENT_SOURCE_MAX_LENGTH,
  WORKFLOW_EVENT_TYPE_MAX_LENGTH,
} from "../workflow-event.js";
import { jsonValueSchema } from "./json-value.js";
import { workflowEventIdSchema, workspaceIdSchema } from "./ids.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

const workflowEventIdentityString = (max: number) => z.string().min(1).max(max);

export const ingestWorkflowEventRequestSchema = z.strictObject({
  source: workflowEventIdentityString(WORKFLOW_EVENT_SOURCE_MAX_LENGTH),
  eventType: workflowEventIdentityString(WORKFLOW_EVENT_TYPE_MAX_LENGTH),
  correlationKey: workflowEventIdentityString(
    WORKFLOW_EVENT_CORRELATION_KEY_MAX_LENGTH,
  ),
  idempotencyKey: workflowEventIdentityString(
    WORKFLOW_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH,
  ),
  payload: jsonValueSchema,
  occurredAt: utcIso8601TimestampSchema.optional(),
});

export const workflowEventResourceSchema = z.strictObject({
  id: workflowEventIdSchema,
  workspaceId: workspaceIdSchema,
  source: workflowEventIdentityString(WORKFLOW_EVENT_SOURCE_MAX_LENGTH),
  eventType: workflowEventIdentityString(WORKFLOW_EVENT_TYPE_MAX_LENGTH),
  correlationKey: workflowEventIdentityString(
    WORKFLOW_EVENT_CORRELATION_KEY_MAX_LENGTH,
  ),
  idempotencyKey: workflowEventIdentityString(
    WORKFLOW_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH,
  ),
  payload: jsonValueSchema,
  occurredAt: utcIso8601TimestampSchema.optional(),
  receivedAt: utcIso8601TimestampSchema,
});
