import type { ModelProfileVersionId } from "./ids.js";
import type { JsonSchemaRecord } from "./json-schema.js";

export const MODEL_PROVIDERS = [
  "OPENAI",
  "ANTHROPIC",
  "GOOGLE_GEMINI",
] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const MODEL_TEXT_ROLES = ["system", "user", "assistant"] as const;

export type ModelTextRole = (typeof MODEL_TEXT_ROLES)[number];

export const MODEL_CONVERSATION_ROLES = [...MODEL_TEXT_ROLES, "tool"] as const;

export type ModelConversationRole = (typeof MODEL_CONVERSATION_ROLES)[number];

export const MODEL_FINISH_REASONS = [
  "stop",
  "length",
  "blocked",
  "tool_call",
  "other",
] as const;

export type ModelFinishReason = (typeof MODEL_FINISH_REASONS)[number];

export function isModelFinishReason(value: string): value is ModelFinishReason {
  return (MODEL_FINISH_REASONS as readonly string[]).includes(value);
}

export const MODEL_BINDING_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const MODEL_TEXT_CONTENT_MAX_LENGTH = 32_768;
export const MODEL_TEXT_MAX_MESSAGES = 64;
export const MODEL_MAX_OUTPUT_TOKENS_MIN = 1;
export const MODEL_MAX_OUTPUT_TOKENS_MAX = 16_384;
export const MODEL_PROVIDER_MODEL_ID_MAX_LENGTH = 256;

export const MODEL_ERROR_CODES = {
  MODEL_BINDING_NOT_FOUND: "MODEL_BINDING_NOT_FOUND",
  MODEL_PROFILE_VERSION_NOT_FOUND: "MODEL_PROFILE_VERSION_NOT_FOUND",
  MODEL_PROVIDER_UNAVAILABLE: "MODEL_PROVIDER_UNAVAILABLE",
  MODEL_INVALID_REQUEST: "MODEL_INVALID_REQUEST",
  MODEL_AUTHENTICATION_ERROR: "MODEL_AUTHENTICATION_ERROR",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  MODEL_RATE_LIMITED: "MODEL_RATE_LIMITED",
  MODEL_QUOTA_EXHAUSTED: "MODEL_QUOTA_EXHAUSTED",
  MODEL_REQUEST_TIMEOUT: "MODEL_REQUEST_TIMEOUT",
  MODEL_CONTENT_BLOCKED: "MODEL_CONTENT_BLOCKED",
  MODEL_CANCELLED: "MODEL_CANCELLED",
  MODEL_PROVIDER_ERROR: "MODEL_PROVIDER_ERROR",
  INVALID_MODEL_RESPONSE: "INVALID_MODEL_RESPONSE",
} as const;

export type ModelErrorCode =
  (typeof MODEL_ERROR_CODES)[keyof typeof MODEL_ERROR_CODES];

export function isModelProvider(value: string): value is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(value);
}

export function isModelBindingName(value: string): boolean {
  return MODEL_BINDING_NAME_PATTERN.test(value);
}

export function isModelErrorCode(value: string): value is ModelErrorCode {
  return (Object.values(MODEL_ERROR_CODES) as readonly string[]).includes(
    value,
  );
}

export interface ModelTextMessage {
  readonly role: ModelTextRole;
  readonly content: string;
}

export interface ModelToolResultMessage {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
}

export type ModelConversationMessage =
  ModelTextMessage | ModelToolResultMessage;

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface GenerateTextInput {
  readonly messages: readonly ModelTextMessage[];
  readonly maxOutputTokens?: number;
}

export interface GenerateCompletionInput {
  readonly messages: readonly ModelConversationMessage[];
  readonly maxOutputTokens?: number;
  readonly toolDefinitions?: readonly ModelToolDefinition[];
  /**
   When set, providers that support JSON/schema-constrained output may use this
   for the completion. Omitted for intermediate tool-loop turns.
   */
  readonly jsonSchema?: JsonSchemaRecord;
}

/**
 * Stage 1 ModelGateway request. Cancellation is an execution/runtime concern
 * and is not part of this serialized contract.
 */
export interface GenerateTextRequest extends GenerateTextInput {
  readonly modelProfileVersionId: ModelProfileVersionId;
}

export interface GenerateCompletionRequest extends GenerateCompletionInput {
  readonly modelProfileVersionId: ModelProfileVersionId;
}

export interface GenerateTextResult {
  readonly text: string;
}

export interface GenerateCompletionResult {
  readonly text?: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly finishReason: ModelFinishReason;
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonSchemaRecord;
}

/**
 * Target invoke payload. Stage 1 does not implement invoke(); tools,
 * structured output, and usage accounting remain later-stage surfaces.
 */
export interface ModelRequest {
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly instructions: string;
  readonly input: unknown;
  readonly structuredOutputSchema?: JsonSchemaRecord;
  readonly toolDefinitions?: readonly ModelToolDefinition[];
  readonly timeoutMs: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ModelUsage {
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly cachedUnits?: number;
}

export interface ModelResponse {
  readonly provider: string;
  readonly model: string;
  readonly providerResponseId?: string;
  readonly output: unknown;
  readonly usage: ModelUsage;
  readonly estimatedCost?: number;
  readonly latencyMs: number;
}

/**
 * Provider SDK types must not escape the adapter that implements this port.
 *
 * Stage 1 implements `generateText`. Cancellation is not part of this portable
 * request contract. The target `invoke` request/response types remain the
 * destination contract and are not implemented in this slice.
 */
export interface ModelGateway {
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>;
  generateCompletion(
    request: GenerateCompletionRequest,
  ): Promise<GenerateCompletionResult>;
}
