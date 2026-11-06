import type { ModelProvider } from "@osva-ai/contracts";

/**
 * Anthropic Messages API path in-repo does not apply `jsonSchema` (M20.2 audit).
 */
export function modelProviderSupportsStructuredJsonSchema(
  provider: ModelProvider,
): boolean {
  return provider === "OPENAI" || provider === "GOOGLE_GEMINI";
}
