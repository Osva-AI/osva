import { z } from "zod";

import {
  artifactDigestSchema,
  artifactReferenceV1Schema,
  artifactIdSchema,
  generateTextInputSchema,
  generateTextResultSchema,
  jsonValueSchema,
} from "@osva/contracts/schemas";
import {
  MEMORY_BINDING_NAME_PATTERN,
  MODEL_BINDING_NAME_PATTERN,
  TOOL_BINDING_NAME_PATTERN,
} from "@osva/contracts";

import {
  runtimeExecutionIdSchema,
  runtimeProtocolErrorSchema,
  runtimeProtocolVersionSchema,
} from "./execute.js";

const modelBindingNameSchema = z.string().regex(MODEL_BINDING_NAME_PATTERN);
const toolBindingNameSchema = z.string().regex(TOOL_BINDING_NAME_PATTERN);
const memoryBindingNameSchema = z.string().regex(MEMORY_BINDING_NAME_PATTERN);

const memoryRecordViewSchema = z.strictObject({
  key: z.string().min(1),
  value: jsonValueSchema,
  revision: z.number().int().min(1),
});

export const runtimeModelGenerateTextRequestSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  bindingName: modelBindingNameSchema,
  input: generateTextInputSchema,
});

export const runtimeModelGenerateTextSuccessSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("SUCCEEDED"),
  result: generateTextResultSchema,
});

export const runtimeModelGenerateTextFailureSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("FAILED"),
  error: runtimeProtocolErrorSchema,
});

export const runtimeModelGenerateTextResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    runtimeModelGenerateTextSuccessSchema,
    runtimeModelGenerateTextFailureSchema,
  ],
);

export const runtimeToolInvokeRequestSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  bindingName: toolBindingNameSchema,
  input: jsonValueSchema,
  idempotencyKey: z.string().min(1).max(256).optional(),
});

export const runtimeToolInvokeSuccessSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("SUCCEEDED"),
  output: jsonValueSchema,
});

export const runtimeToolInvokeFailureSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("FAILED"),
  error: runtimeProtocolErrorSchema,
});

export const runtimeToolInvokeResponseSchema = z.discriminatedUnion("outcome", [
  runtimeToolInvokeSuccessSchema,
  runtimeToolInvokeFailureSchema,
]);

export const runtimeMemoryGetRequestSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  bindingName: memoryBindingNameSchema,
  key: z.string().min(1),
});

export const runtimeMemoryGetSuccessSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("SUCCEEDED"),
  record: memoryRecordViewSchema,
});

export const runtimeMemoryGetFailureSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("FAILED"),
  error: runtimeProtocolErrorSchema,
});

export const runtimeMemoryGetResponseSchema = z.discriminatedUnion("outcome", [
  runtimeMemoryGetSuccessSchema,
  runtimeMemoryGetFailureSchema,
]);

export const runtimeMemorySetRequestSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  bindingName: memoryBindingNameSchema,
  key: z.string().min(1),
  value: jsonValueSchema,
  expectedRevision: z.number().int().min(1).optional(),
});

export const runtimeMemorySetSuccessSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("SUCCEEDED"),
  record: memoryRecordViewSchema,
});

export const runtimeMemorySetFailureSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("FAILED"),
  error: runtimeProtocolErrorSchema,
});

export const runtimeMemorySetResponseSchema = z.discriminatedUnion("outcome", [
  runtimeMemorySetSuccessSchema,
  runtimeMemorySetFailureSchema,
]);

export const runtimeMemoryDeleteRequestSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  bindingName: memoryBindingNameSchema,
  key: z.string().min(1),
  expectedRevision: z.number().int().min(1).optional(),
});

export const runtimeMemoryDeleteSuccessSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("SUCCEEDED"),
});

export const runtimeMemoryDeleteFailureSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("FAILED"),
  error: runtimeProtocolErrorSchema,
});

export const runtimeMemoryDeleteResponseSchema = z.discriminatedUnion(
  "outcome",
  [runtimeMemoryDeleteSuccessSchema, runtimeMemoryDeleteFailureSchema],
);

export const runtimeMemoryListRequestSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  bindingName: memoryBindingNameSchema,
  prefix: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});

export const runtimeMemoryListSuccessSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("SUCCEEDED"),
  items: z.array(memoryRecordViewSchema),
  nextCursor: z.string().min(1).optional(),
});

export const runtimeMemoryListFailureSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("FAILED"),
  error: runtimeProtocolErrorSchema,
});

export const runtimeMemoryListResponseSchema = z.discriminatedUnion("outcome", [
  runtimeMemoryListSuccessSchema,
  runtimeMemoryListFailureSchema,
]);

const runtimeArtifactViewSchema = z.strictObject({
  id: artifactIdSchema,
  name: z.string().min(1),
  mediaType: z.string().min(1),
  sizeBytes: z.number().int().min(0),
  digest: artifactDigestSchema,
  metadata: z.record(z.string(), jsonValueSchema),
  reference: artifactReferenceV1Schema,
});

export const runtimeArtifactGetRequestSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  artifactId: artifactIdSchema,
});

export const runtimeArtifactGetSuccessSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("SUCCEEDED"),
  artifact: runtimeArtifactViewSchema,
});

export const runtimeArtifactGetFailureSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("FAILED"),
  error: runtimeProtocolErrorSchema,
});

export const runtimeArtifactGetResponseSchema = z.discriminatedUnion(
  "outcome",
  [runtimeArtifactGetSuccessSchema, runtimeArtifactGetFailureSchema],
);

export const runtimeArtifactCreateSuccessSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("SUCCEEDED"),
  artifact: runtimeArtifactViewSchema,
});

export const runtimeArtifactCreateFailureSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("FAILED"),
  error: runtimeProtocolErrorSchema,
});

export const runtimeArtifactCreateResponseSchema = z.discriminatedUnion(
  "outcome",
  [runtimeArtifactCreateSuccessSchema, runtimeArtifactCreateFailureSchema],
);
