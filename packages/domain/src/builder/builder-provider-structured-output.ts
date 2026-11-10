import type { JsonSchemaRecord, ModelProvider } from "@osva-ai/contracts";

import { BuilderProposalAnthropicRecordsJsonSchema } from "./builder-proposal-anthropic-json-schema.js";
import { BuilderProposalOpenAiJsonSchema } from "./builder-proposal-openai-json-schema.js";

/** Providers with native JSON-schema constrained generation for the builder flow. */
export function modelProviderSupportsStructuredJsonSchema(
  provider: ModelProvider,
): boolean {
  return (
    provider === "OPENAI" ||
    provider === "GOOGLE_GEMINI" ||
    provider === "ANTHROPIC"
  );
}

/**
 * Provider-facing constrained schema. OpenAI and Gemini keep the canonical
 * BuilderProposal envelope. Anthropic uses flat records IR to stay within
 * grammar limits.
 */
export function jsonSchemaForBuilderProvider(
  provider: ModelProvider,
): JsonSchemaRecord {
  if (provider === "ANTHROPIC") {
    return BuilderProposalAnthropicRecordsJsonSchema;
  }
  return BuilderProposalOpenAiJsonSchema;
}
