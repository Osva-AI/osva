import { z } from "zod";

import {
  BATCH_INFERENCE_CONTRACT_FORMAT_VERSION,
  BATCH_INFERENCE_EXECUTION_MODES,
  BATCH_INFERENCE_ITEM_STATUSES,
  BATCH_INFERENCE_JOB_STATUSES,
  BATCH_INFERENCE_MAX_ITEM_COUNT,
  BATCH_INFERENCE_MAX_ITEM_PAYLOAD_BYTES,
  BATCH_INFERENCE_PROVIDER_CORRELATION_ID_MAX_LENGTH,
  BATCH_INFERENCE_PROVIDER_JOB_STATUSES,
} from "../batch-inference.js";
import { MODEL_ERROR_CODES, MODEL_PROVIDERS } from "../model-gateway.js";
import {
  batchInferenceItemIdSchema,
  batchInferenceJobIdSchema,
  modelProfileVersionIdSchema,
  modelProviderConnectionVersionIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import {
  generateCompletionInputSchema,
  generateCompletionResultSchema,
  modelUsageSchema,
} from "./model-gateway.js";

export const batchInferenceContractFormatVersionSchema = z.literal(
  BATCH_INFERENCE_CONTRACT_FORMAT_VERSION,
);

export const batchInferenceJobStatusSchema = z.enum(
  BATCH_INFERENCE_JOB_STATUSES,
);

export const batchInferenceProviderJobStatusSchema = z.enum(
  BATCH_INFERENCE_PROVIDER_JOB_STATUSES,
);

export const batchInferenceItemStatusSchema = z.enum(
  BATCH_INFERENCE_ITEM_STATUSES,
);

export const batchInferenceExecutionModeSchema = z.enum(
  BATCH_INFERENCE_EXECUTION_MODES,
);

export const batchInferenceProviderCorrelationIdSchema = z
  .string()
  .min(1)
  .max(BATCH_INFERENCE_PROVIDER_CORRELATION_ID_MAX_LENGTH);

export const batchInferenceSubmissionFingerprintSchema = z
  .string()
  .min(16)
  .max(128);

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export const batchInferenceItemRequestSchema = z.strictObject({
  itemId: batchInferenceItemIdSchema,
  providerCorrelationId: batchInferenceProviderCorrelationIdSchema,
  input: generateCompletionInputSchema,
});

export const batchInferenceCreateJobRequestSchema = z
  .strictObject({
    formatVersion: batchInferenceContractFormatVersionSchema,
    workspaceId: workspaceIdSchema,
    jobId: batchInferenceJobIdSchema,
    modelProfileVersionId: modelProfileVersionIdSchema,
    providerConnectionVersionId: modelProviderConnectionVersionIdSchema,
    items: z
      .array(batchInferenceItemRequestSchema)
      .min(1)
      .max(BATCH_INFERENCE_MAX_ITEM_COUNT),
    submissionFingerprint: batchInferenceSubmissionFingerprintSchema,
    executionMode: batchInferenceExecutionModeSchema,
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    const itemIds = new Set<string>();
    const correlationIds = new Set<string>();
    const itemPayloadCheck = (
      item: (typeof value.items)[number],
      index: number,
    ) => {
      const idKey = item.itemId as string;
      if (itemIds.has(idKey)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate batch item id: ${idKey}`,
          path: ["items", index, "itemId"],
        });
      }
      itemIds.add(idKey);

      if (correlationIds.has(item.providerCorrelationId)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate provider correlation id: ${item.providerCorrelationId}`,
          path: ["items", index, "providerCorrelationId"],
        });
      }
      correlationIds.add(item.providerCorrelationId);

      const serialized = JSON.stringify(item.input);
      if (utf8ByteLength(serialized) > BATCH_INFERENCE_MAX_ITEM_PAYLOAD_BYTES) {
        ctx.addIssue({
          code: "custom",
          message: `item payload exceeds ${BATCH_INFERENCE_MAX_ITEM_PAYLOAD_BYTES} bytes`,
          path: ["items", index, "input"],
        });
      }
    };

    value.items.forEach(itemPayloadCheck);
  });

export const batchInferenceItemErrorSchema = z.strictObject({
  code: z.union([
    z.enum(
      Object.values(MODEL_ERROR_CODES) as [
        (typeof MODEL_ERROR_CODES)[keyof typeof MODEL_ERROR_CODES],
        ...(typeof MODEL_ERROR_CODES)[keyof typeof MODEL_ERROR_CODES][],
      ],
    ),
    z.literal("BATCH_ITEM_PROVIDER_ERROR"),
  ]),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
  providerErrorCode: z.string().optional(),
});

export const batchInferenceCancelRequestSchema = z.strictObject({
  formatVersion: batchInferenceContractFormatVersionSchema,
  workspaceId: workspaceIdSchema,
  jobId: batchInferenceJobIdSchema,
  reason: z.string().max(512).optional(),
});

export const batchInferenceEligibilityPolicySchema = z.strictObject({
  batchInferenceEnabled: z.boolean(),
  allowedProviders: z.array(z.enum(MODEL_PROVIDERS)).optional(),
  maxItemCount: z
    .int()
    .positive()
    .max(BATCH_INFERENCE_MAX_ITEM_COUNT)
    .optional(),
  denySensitiveWorkloads: z.boolean().optional(),
});

export const batchInferenceItemOutcomeSchema = z.strictObject({
  itemId: batchInferenceItemIdSchema,
  providerCorrelationId: batchInferenceProviderCorrelationIdSchema,
  status: batchInferenceItemStatusSchema,
  result: generateCompletionResultSchema.optional(),
  usage: modelUsageSchema.optional(),
  error: batchInferenceItemErrorSchema.optional(),
  providerRequestId: z.string().optional(),
});
