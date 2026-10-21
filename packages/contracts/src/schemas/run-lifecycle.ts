import { z } from "zod";

import {
  agentIdSchema,
  agentVersionIdSchema,
  evaluationCaseIdSchema,
  evaluationRunIdSchema,
  modelProfileVersionIdSchema,
  toolVersionIdSchema,
  runAttemptIdSchema,
  runIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { RUN_ATTEMPT_STATES, RUN_STATES } from "../run-state.js";
import { RUN_ATTEMPT_EXECUTION_STATES } from "../run-lifecycle.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";
import { jsonValueSchema } from "./json-value.js";

const runStateSchema = z.enum(RUN_STATES);
const runAttemptStateSchema = z.enum(RUN_ATTEMPT_STATES);

export const createRunRequestSchema = z.strictObject({
  agentId: agentIdSchema,
  agentVersionId: agentVersionIdSchema,
  input: z.unknown(),
  idempotencyKey: z.string().min(1).optional(),
  restrictPersistentMemory: z.boolean().optional(),
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
    toolVersionBindings: z.record(z.string().min(1), toolVersionIdSchema),
  }),
  input: z.unknown(),
  createdAt: utcIso8601TimestampSchema,
  updatedAt: utcIso8601TimestampSchema,
  idempotencyKey: z.string().min(1).optional(),
  evaluationRunId: evaluationRunIdSchema.optional(),
  evaluationCaseId: evaluationCaseIdSchema.optional(),
  restrictPersistentMemory: z.boolean().optional(),
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
  execution: z
    .strictObject({
      state: z.enum(RUN_ATTEMPT_EXECUTION_STATES),
      leased: z.boolean(),
      leaseExpiresAt: utcIso8601TimestampSchema.optional(),
      executionGeneration: z.int().nonnegative(),
      interrupted: z.boolean(),
      recoveryReason: z.string().min(1).optional(),
      observedAt: utcIso8601TimestampSchema,
    })
    .optional(),
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
