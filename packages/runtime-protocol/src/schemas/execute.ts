import { z } from "zod";

import { jsonValueSchema } from "@osva/contracts/schemas";

import {
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_VERSION,
} from "../constants.js";

export const runtimeProtocolVersionSchema = z.literal(RUNTIME_PROTOCOL_VERSION);

export const runtimeExecutionIdSchema = z.string().min(1).max(128);

export const runtimeProtocolErrorSchema = z.strictObject({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(500),
});

export const runtimeCapabilityCredentialSchema = z.strictObject({
  endpoint: z.string().min(1).max(2_048),
  token: z.string().min(1).max(8_192),
});

export const runtimeExecuteRequestSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  input: jsonValueSchema,
  capabilities: runtimeCapabilityCredentialSchema,
});

export const runtimeExecuteSuccessSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("SUCCEEDED"),
  output: jsonValueSchema,
});

export const runtimeExecuteFailureSchema = z.strictObject({
  protocolVersion: runtimeProtocolVersionSchema,
  executionId: runtimeExecutionIdSchema,
  outcome: z.literal("FAILED"),
  error: runtimeProtocolErrorSchema,
});

export const runtimeExecuteResponseSchema = z.discriminatedUnion("outcome", [
  runtimeExecuteSuccessSchema,
  runtimeExecuteFailureSchema,
]);

export const runtimeProtocolFailureCategorySchema = z.enum([
  RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
  RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
  RUNTIME_PROTOCOL_ERROR_CODES.AGENT_EXECUTION_FAILED,
]);
