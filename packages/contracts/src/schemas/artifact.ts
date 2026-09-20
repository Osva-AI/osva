import { z } from "zod";

import {
  ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH,
  ARTIFACT_MEDIA_TYPE_MAX_LENGTH,
  ARTIFACT_NAME_MAX_LENGTH,
  ARTIFACT_REFERENCE_TYPE,
} from "../artifact.js";
import { isSha256IntegrityDigest } from "../trusted-runtime.js";
import {
  artifactIdSchema,
  runAttemptIdSchema,
  runIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { jsonValueSchema } from "./json-value.js";

export const artifactDigestSchema = z.string().refine(isSha256IntegrityDigest, {
  message: "digest must be sha256:<64 lowercase hex>.",
});

export const artifactReferenceV1Schema = z.strictObject({
  type: z.literal(ARTIFACT_REFERENCE_TYPE),
  artifactId: artifactIdSchema,
});

export const artifactProducerResourceSchema = z.strictObject({
  runId: runIdSchema,
  runAttemptId: runAttemptIdSchema,
});

export const artifactResourceSchema = z.strictObject({
  id: artifactIdSchema,
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(ARTIFACT_NAME_MAX_LENGTH),
  mediaType: z.string().min(1).max(ARTIFACT_MEDIA_TYPE_MAX_LENGTH),
  sizeBytes: z.number().int().min(0),
  digest: artifactDigestSchema,
  metadata: z.record(z.string(), jsonValueSchema),
  producer: artifactProducerResourceSchema.optional(),
  createdAt: z.string().min(1),
});

export const artifactListResourceSchema = z.strictObject({
  items: z.array(artifactResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const listArtifactsQuerySchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  runId: runIdSchema.optional(),
  runAttemptId: runAttemptIdSchema.optional(),
  limit: z.string().optional(),
  cursor: z.string().min(1).optional(),
});

export const artifactListCursorPayloadSchema = z.strictObject({
  createdAt: z.string().min(1),
  id: artifactIdSchema,
});

export const createArtifactFormFieldsSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(ARTIFACT_NAME_MAX_LENGTH),
  mediaType: z.string().min(1).max(ARTIFACT_MEDIA_TYPE_MAX_LENGTH).optional(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
  expectedDigest: artifactDigestSchema.optional(),
  idempotencyKey: z
    .string()
    .min(1)
    .max(ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH)
    .optional(),
});

export const createRuntimeArtifactFormFieldsSchema = z.strictObject({
  executionId: runAttemptIdSchema,
  name: z.string().min(1).max(ARTIFACT_NAME_MAX_LENGTH),
  mediaType: z.string().min(1).max(ARTIFACT_MEDIA_TYPE_MAX_LENGTH).optional(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
  expectedDigest: artifactDigestSchema.optional(),
  idempotencyKey: z
    .string()
    .min(1)
    .max(ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH)
    .optional(),
});
