import { z } from "zod";

import { runAttemptIdSchema, runIdSchema } from "./ids.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";
import { RUN_CHECKPOINT_ENVELOPE_VERSION } from "../run-checkpoint.js";
import { RUN_RECOVERY_METADATA_VERSION } from "../run-recovery.js";

const runRecoveryBlockedSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  at: utcIso8601TimestampSchema,
});

export const runRecoveryMetadataResourceSchema = z.strictObject({
  version: z.literal(RUN_RECOVERY_METADATA_VERSION),
  recoveryAttemptCount: z.int().nonnegative(),
  automaticRecoveryEnabled: z.boolean(),
  lastRecoveryAt: utcIso8601TimestampSchema.optional(),
  blocked: runRecoveryBlockedSchema.optional(),
});

export const runCheckpointSummaryResourceSchema = z.strictObject({
  id: z.string().min(1),
  sequence: z.int().positive(),
  runAttemptId: runAttemptIdSchema,
  executionGeneration: z.int().positive(),
  envelopeVersion: z.literal(RUN_CHECKPOINT_ENVELOPE_VERSION),
  cursorPhase: z.enum(["after_prefetch", "after_model", "after_tool"]),
  checkpointSequence: z.int().positive(),
  createdAt: utcIso8601TimestampSchema,
});

export const runCheckpointListResourceSchema = z.strictObject({
  runId: runIdSchema,
  checkpoints: z.array(runCheckpointSummaryResourceSchema),
});

export const runRecoveryBlockedOperationResourceSchema = z.strictObject({
  operationKey: z.string().min(1),
  status: z.enum(["PENDING", "UNCERTAIN", "FAILED", "COMMITTED"]),
  idempotencyClass: z.enum([
    "PURE",
    "READ_ONLY",
    "IDEMPOTENT_WRITE",
    "UNKNOWN_WRITE",
    "RECONCILE",
  ]),
  bindingName: z.string().min(1),
  toolVersionId: z.string().min(1),
});

export const runRecoveryStatusResourceSchema = z.strictObject({
  runId: runIdSchema,
  runStatus: z.enum([
    "PENDING",
    "QUEUED",
    "RUNNING",
    "INTERRUPTED",
    "SUCCEEDED",
    "FAILED",
    "TIMED_OUT",
    "CANCELLED",
  ]),
  eligible: z.boolean(),
  ineligibleCode: z.string().min(1).optional(),
  ineligibleMessage: z.string().min(1).optional(),
  recovery: runRecoveryMetadataResourceSchema.optional(),
  latestCheckpoint: runCheckpointSummaryResourceSchema.optional(),
  blockedOperations: z.array(runRecoveryBlockedOperationResourceSchema),
});

export const resumeRunRequestSchema = z.strictObject({
  idempotencyKey: z.string().min(1).optional(),
});

export const resumeRunResponseSchema = z.strictObject({
  runId: runIdSchema,
  runAttemptId: runAttemptIdSchema,
  outcome: z.enum(["scheduled", "already_scheduled"]),
});
