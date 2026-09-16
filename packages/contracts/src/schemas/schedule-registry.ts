import { z } from "zod";

import {
  agentIdSchema,
  agentVersionIdSchema,
  runIdSchema,
  scheduleIdSchema,
  scheduleOccurrenceIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { jsonValueSchema } from "./json-value.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

export const createScheduleRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  agentId: agentIdSchema,
  agentVersionId: agentVersionIdSchema,
  cronExpression: z.string().min(1),
  timezone: z.string().min(1),
  input: jsonValueSchema,
  enabled: z.boolean().optional(),
});

export const updateScheduleRequestSchema = z.strictObject({
  name: z.string().min(1).optional(),
  agentVersionId: agentVersionIdSchema.optional(),
  cronExpression: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  input: jsonValueSchema.optional(),
  enabled: z.boolean().optional(),
});

export const scheduleResourceSchema = z.strictObject({
  id: scheduleIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  agentId: agentIdSchema,
  agentVersionId: agentVersionIdSchema,
  cronExpression: z.string().min(1),
  timezone: z.string().min(1),
  input: jsonValueSchema,
  enabled: z.boolean(),
  nextRunAt: utcIso8601TimestampSchema.nullable(),
  createdAt: utcIso8601TimestampSchema,
  updatedAt: utcIso8601TimestampSchema,
});

export const scheduleListResourceSchema = z.strictObject({
  schedules: z.array(scheduleResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const scheduleOccurrenceResourceSchema = z.strictObject({
  id: scheduleOccurrenceIdSchema,
  scheduleId: scheduleIdSchema,
  scheduledFor: utcIso8601TimestampSchema,
  agentVersionId: agentVersionIdSchema,
  runId: runIdSchema.nullable(),
  createdAt: utcIso8601TimestampSchema,
  dispatchedAt: utcIso8601TimestampSchema.nullable(),
});

export const scheduleOccurrenceListResourceSchema = z.strictObject({
  occurrences: z.array(scheduleOccurrenceResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const listSchedulesQuerySchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  limit: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
});

export const listScheduleOccurrencesQuerySchema = z.strictObject({
  limit: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
