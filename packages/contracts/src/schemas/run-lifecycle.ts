import { z } from "zod";

import {
  agentIdSchema,
  agentVersionIdSchema,
  modelProfileVersionIdSchema,
  runAttemptIdSchema,
  runIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { RUN_ATTEMPT_STATES, RUN_STATES } from "../run-state.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";
import { jsonValueSchema } from "./json-value.js";

const runStateSchema = z.enum(RUN_STATES);
const runAttemptStateSchema = z.enum(RUN_ATTEMPT_STATES);

export const createRunRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  agentId: agentIdSchema,
  agentVersionId: agentVersionIdSchema,
  input: z.unknown(),
  idempotencyKey: z.string().min(1).optional(),
});

export const runResourceSchema = z.strictObject({
  id: runIdSchema,
  workspaceId: workspaceIdSchema,
  agentId: agentIdSchema,
  status: runStateSchema,
  effectiveBindings: z.strictObject({
    agentVersionId: agentVersionIdSchema,
    modelProfileVersionBindings: z.record(
      z.string().min(1),
      modelProfileVersionIdSchema,
    ),
  }),
  input: z.unknown(),
  createdAt: utcIso8601TimestampSchema,
  updatedAt: utcIso8601TimestampSchema,
  idempotencyKey: z.string().min(1).optional(),
});

export const runAttemptResourceSchema = z.strictObject({
  id: runAttemptIdSchema,
  runId: runIdSchema,
  sequence: z.int().positive(),
  status: runAttemptStateSchema,
  createdAt: utcIso8601TimestampSchema,
  startedAt: utcIso8601TimestampSchema.optional(),
  completedAt: utcIso8601TimestampSchema.optional(),
  error: z
    .strictObject({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .optional(),
  output: jsonValueSchema.optional(),
});

export const createRunResponseSchema = z.strictObject({
  run: runResourceSchema,
  runAttempt: runAttemptResourceSchema,
});

export const runListResourceSchema = z.strictObject({
  runs: z.array(runResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const runAttemptListResourceSchema = z.strictObject({
  attempts: z.array(runAttemptResourceSchema),
});

export const runListCursorPayloadSchema = z.strictObject({
  createdAt: utcIso8601TimestampSchema,
  id: runIdSchema,
});

export const listRunsQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "limit must be a positive integer")
    .optional(),
  cursor: z.string().min(1).optional(),
  agentId: agentIdSchema.optional(),
  agentVersionId: agentVersionIdSchema.optional(),
  status: runStateSchema.optional(),
});
