import { z } from "zod";

import {
  generateTextInputSchema,
  generateTextResultSchema,
  jsonValueSchema,
} from "@osva/contracts/schemas";
import {
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
