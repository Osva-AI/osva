import { z } from "zod";

import { INFERENCE_MODEL_INVOCATION_SOURCES } from "../inference-cache.js";
import { MODEL_ERROR_CODES, MODEL_FINISH_REASONS } from "../model-gateway.js";
import {
  MODEL_STREAM_CANCELLATION_REASONS,
  MODEL_STREAM_EVENT_FORMAT_VERSION,
  MODEL_STREAM_MAX_EVENT_COUNT,
  MODEL_STREAM_MAX_TEXT_DELTA_BYTES,
  MODEL_STREAM_MAX_TOOL_ARGUMENT_BYTES,
} from "../model-streaming.js";
import { utf8ByteLength } from "../utf8-byte-length.js";
import { modelToolCallSchema, modelUsageSchema } from "./model-gateway.js";

const streamIdSchema = z.string().min(1).max(128);
const sequenceSchema = z
  .int()
  .nonnegative()
  .max(MODEL_STREAM_MAX_EVENT_COUNT - 1);

const textDeltaSchema = z
  .string()
  .max(MODEL_STREAM_MAX_TEXT_DELTA_BYTES)
  .refine(
    (value) => utf8ByteLength(value) <= MODEL_STREAM_MAX_TEXT_DELTA_BYTES,
    "TEXT_DELTA exceeds UTF-8 byte limit.",
  );

const baseFields = {
  streamFormatVersion: z.literal(MODEL_STREAM_EVENT_FORMAT_VERSION),
  streamId: streamIdSchema,
  sequence: sequenceSchema,
} as const;

const textDeltaEventSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("TEXT_DELTA"),
  textDelta: textDeltaSchema,
});

const toolCallStartEventSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("TOOL_CALL_START"),
  toolCallIndex: z.int().nonnegative().max(128),
  toolCallId: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
});

const toolCallArgumentsDeltaEventSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("TOOL_CALL_ARGUMENTS_DELTA"),
  toolCallIndex: z.int().nonnegative().max(128),
  argumentsDelta: z
    .string()
    .max(MODEL_STREAM_MAX_TOOL_ARGUMENT_BYTES)
    .refine(
      (value) => utf8ByteLength(value) <= MODEL_STREAM_MAX_TOOL_ARGUMENT_BYTES,
      "argumentsDelta exceeds UTF-8 byte limit.",
    ),
});

const toolCallCompleteEventSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("TOOL_CALL_COMPLETE"),
  toolCallIndex: z.int().nonnegative().max(128),
  arguments: z.unknown().optional(),
});

const usageFinalEventSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("USAGE_FINAL"),
  usage: modelUsageSchema,
  invocationSource: z.enum(INFERENCE_MODEL_INVOCATION_SOURCES).optional(),
  providerRequestId: z.string().min(1).max(256).optional(),
});

const completedEventSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("COMPLETED"),
  finishReason: z.enum(MODEL_FINISH_REASONS),
  providerRequestId: z.string().min(1).max(256).optional(),
});

const modelErrorCodeSchema = z.enum(
  Object.values(MODEL_ERROR_CODES) as [
    (typeof MODEL_ERROR_CODES)[keyof typeof MODEL_ERROR_CODES],
    ...(typeof MODEL_ERROR_CODES)[keyof typeof MODEL_ERROR_CODES][],
  ],
);

const failedEventSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("FAILED"),
  code: modelErrorCodeSchema,
  message: z.string().min(1).max(500),
  retryable: z.boolean().optional(),
});

const cancelledEventSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("CANCELLED"),
  reason: z.enum(MODEL_STREAM_CANCELLATION_REASONS).optional(),
});

export const modelStreamEventSchema = z.discriminatedUnion("kind", [
  textDeltaEventSchema,
  toolCallStartEventSchema,
  toolCallArgumentsDeltaEventSchema,
  toolCallCompleteEventSchema,
  usageFinalEventSchema,
  completedEventSchema,
  failedEventSchema,
  cancelledEventSchema,
]);

export const modelStreamEventListSchema = z
  .array(modelStreamEventSchema)
  .max(MODEL_STREAM_MAX_EVENT_COUNT);

/** Validates a reconstructed tool call matches completion contract bounds. */
export const assembledModelToolCallSchema = modelToolCallSchema;
