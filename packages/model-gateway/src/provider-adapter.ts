import type {
  JsonSchemaRecord,
  ModelConversationMessage,
  ModelToolDefinition,
} from "@osva-ai/contracts";

import type { ProviderGenerateTextResult } from "./usage.js";

/**
 * Provider-neutral request after ModelGateway has loaded the immutable
 * ModelProfileVersion. The concrete provider model ID is allowed here because
 * this is already below the provider-routing boundary. SDK types are not.
 */
export interface ResolvedProviderGenerateTextRequest {
  readonly model: string;
  readonly messages: readonly ModelConversationMessage[];
  readonly maxOutputTokens?: number;
  readonly toolDefinitions?: readonly ModelToolDefinition[];
  readonly jsonSchema?: JsonSchemaRecord;
  readonly signal?: AbortSignal;
}

/**
 * Internal execution cancellation. Not part of the public GenerateTextRequest
 * contract or runtime IPC.
 */
export interface ModelGatewayGenerateTextOptions {
  readonly signal?: AbortSignal;
}

export interface ModelProviderAdapter {
  generateText(
    request: ResolvedProviderGenerateTextRequest,
  ): Promise<ProviderGenerateTextResult>;
}
