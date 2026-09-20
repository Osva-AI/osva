import { z } from "zod";

import {
  KNOWLEDGE_ATTRIBUTES_MAX_SERIALIZED_BYTES,
  KNOWLEDGE_IDEMPOTENCY_KEY_MAX_LENGTH,
  KNOWLEDGE_INDEX_STATES,
  KNOWLEDGE_DISTANCE_METRICS,
  KNOWLEDGE_MAX_FILTER_KEYS,
  KNOWLEDGE_MAX_FILTER_VALUE_LENGTH,
  KNOWLEDGE_MAX_INDEX_IDS_PER_RETRIEVE,
  KNOWLEDGE_MAX_QUERY_LENGTH,
  KNOWLEDGE_MAX_TOP_K,
  KNOWLEDGE_SOURCE_KEY_MAX_LENGTH,
  KNOWLEDGE_SOURCE_NAME_MAX_LENGTH,
} from "../knowledge.js";
import { artifactReferenceV1Schema } from "./artifact.js";
import {
  artifactIdSchema,
  knowledgeChunkIdSchema,
  knowledgeIndexIdSchema,
  knowledgeSourceIdSchema,
  workspaceIdSchema,
} from "./ids.js";
const knowledgeScalarFilterValueSchema = z.union([
  z.string().max(KNOWLEDGE_MAX_FILTER_VALUE_LENGTH),
  z.number(),
  z.boolean(),
]);

export const knowledgeFlatAttributesSchema = z
  .record(z.string(), knowledgeScalarFilterValueSchema)
  .refine(
    (value) =>
      JSON.stringify(value).length <= KNOWLEDGE_ATTRIBUTES_MAX_SERIALIZED_BYTES,
    {
      message: `attributes must be at most ${KNOWLEDGE_ATTRIBUTES_MAX_SERIALIZED_BYTES} serialized bytes.`,
    },
  );

export const knowledgeRetrieveFilterSchema = z
  .record(z.string(), knowledgeScalarFilterValueSchema)
  .refine((value) => Object.keys(value).length <= KNOWLEDGE_MAX_FILTER_KEYS, {
    message: `filter may contain at most ${KNOWLEDGE_MAX_FILTER_KEYS} keys.`,
  });

export const knowledgeChunkLocationSchema = z.strictObject({
  page: z.number().int().positive().optional(),
  heading: z.string().min(1).optional(),
  sourceSegmentOrdinal: z.number().int().nonnegative().optional(),
});

export const createKnowledgeSourceRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  key: z.string().min(1).max(KNOWLEDGE_SOURCE_KEY_MAX_LENGTH),
  name: z.string().min(1).max(KNOWLEDGE_SOURCE_NAME_MAX_LENGTH),
  artifactId: artifactIdSchema,
  attributes: knowledgeFlatAttributesSchema.optional(),
  idempotencyKey: z
    .string()
    .min(1)
    .max(KNOWLEDGE_IDEMPOTENCY_KEY_MAX_LENGTH)
    .optional(),
});

export const knowledgeListCursorPayloadSchema = z.strictObject({
  createdAt: z.string().min(1),
  id: z.string().min(1),
});

export const listKnowledgeSourcesQuerySchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  limit: z.string().optional(),
  cursor: z.string().min(1).optional(),
});

export const createKnowledgeIndexRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  idempotencyKey: z
    .string()
    .min(1)
    .max(KNOWLEDGE_IDEMPOTENCY_KEY_MAX_LENGTH)
    .optional(),
});

export const retryKnowledgeIndexRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
});

export const knowledgeRetrieveRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  knowledgeIndexIds: z
    .array(knowledgeIndexIdSchema)
    .min(1)
    .max(KNOWLEDGE_MAX_INDEX_IDS_PER_RETRIEVE),
  query: z.string().min(1).max(KNOWLEDGE_MAX_QUERY_LENGTH),
  topK: z.number().int().min(1).max(KNOWLEDGE_MAX_TOP_K).optional(),
  filter: knowledgeRetrieveFilterSchema.optional(),
});

export const knowledgeSourceResourceSchema = z.strictObject({
  id: knowledgeSourceIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  artifactId: artifactIdSchema,
  attributes: knowledgeFlatAttributesSchema,
  createdAt: z.string().min(1),
});

export const knowledgeIndexResourceSchema = z.strictObject({
  id: knowledgeIndexIdSchema,
  workspaceId: workspaceIdSchema,
  knowledgeSourceId: knowledgeSourceIdSchema,
  status: z.enum(KNOWLEDGE_INDEX_STATES),
  parserKey: z.string().min(1),
  parserVersion: z.string().min(1),
  chunkerKey: z.string().min(1),
  chunkerVersion: z.string().min(1),
  chunkSize: z.number().int().positive(),
  chunkOverlap: z.number().int().nonnegative(),
  embeddingProvider: z.string().min(1),
  embeddingModel: z.string().min(1),
  embeddingDimensions: z.number().int().positive(),
  distanceMetric: z.enum(KNOWLEDGE_DISTANCE_METRICS),
  pipelineFingerprint: z.string().min(1),
  extractedArtifactId: artifactIdSchema.optional(),
  attemptCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative().optional(),
  embeddedChunkCount: z.number().int().nonnegative().optional(),
  lastErrorCode: z.string().min(1).optional(),
  lastErrorMessage: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  readyAt: z.string().min(1).optional(),
});

export const knowledgeHitSchema = z.strictObject({
  knowledgeChunkId: knowledgeChunkIdSchema,
  knowledgeIndexId: knowledgeIndexIdSchema,
  knowledgeSourceId: knowledgeSourceIdSchema,
  artifactReference: artifactReferenceV1Schema,
  text: z.string().min(1),
  score: z.number(),
  location: knowledgeChunkLocationSchema.optional(),
  attributes: knowledgeFlatAttributesSchema,
});

export const knowledgeRetrieveResponseSchema = z.strictObject({
  hits: z.array(knowledgeHitSchema),
});
