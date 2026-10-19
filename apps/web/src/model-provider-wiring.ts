import {
  AnthropicProviderAdapter,
  type AnthropicProviderAdapterOptions,
} from "@osva/adapters-model-anthropic";
import {
  GeminiProviderAdapter,
  type GeminiProviderAdapterOptions,
} from "@osva/adapters-model-gemini";
import {
  OpenAIProviderAdapter,
  type OpenAIProviderAdapterOptions,
} from "@osva/adapters-model-openai";
import type { ModelProvider } from "@osva-ai/contracts";
import type { ModelProviderAdapter } from "@osva/model-gateway";

export interface LegacyModelProviderEnvOptions {
  readonly openai?: Omit<OpenAIProviderAdapterOptions, "apiKey"> & {
    readonly apiKey?: string;
  };
  readonly anthropic?: Omit<AnthropicProviderAdapterOptions, "apiKey"> & {
    readonly apiKey?: string;
  };
  readonly gemini?: Omit<GeminiProviderAdapterOptions, "apiKey"> & {
    readonly apiKey?: string;
  };
}

export function composeLegacyModelProviders(
  env: NodeJS.ProcessEnv,
  overrides: LegacyModelProviderEnvOptions = {},
): Partial<Record<ModelProvider, ModelProviderAdapter>> {
  const providers: Partial<Record<ModelProvider, ModelProviderAdapter>> = {};

  const openaiApiKey = overrides.openai?.apiKey ?? env.OPENAI_API_KEY?.trim();
  if (openaiApiKey !== undefined && openaiApiKey.length > 0) {
    providers.OPENAI = new OpenAIProviderAdapter({
      apiKey: openaiApiKey,
      baseURL: overrides.openai?.baseURL,
      fetch: overrides.openai?.fetch,
      maxRetries: overrides.openai?.maxRetries,
      timeout: overrides.openai?.timeout,
    });
  }

  const anthropicApiKey =
    overrides.anthropic?.apiKey ?? env.ANTHROPIC_API_KEY?.trim();
  if (anthropicApiKey !== undefined && anthropicApiKey.length > 0) {
    providers.ANTHROPIC = new AnthropicProviderAdapter({
      apiKey: anthropicApiKey,
      baseURL: overrides.anthropic?.baseURL,
      fetch: overrides.anthropic?.fetch,
      maxRetries: overrides.anthropic?.maxRetries,
      timeout: overrides.anthropic?.timeout,
    });
  }

  const geminiApiKey =
    overrides.gemini?.apiKey ?? env.GOOGLE_GEMINI_API_KEY?.trim();
  if (geminiApiKey !== undefined && geminiApiKey.length > 0) {
    providers.GOOGLE_GEMINI = new GeminiProviderAdapter({
      apiKey: geminiApiKey,
      baseURL: overrides.gemini?.baseURL,
      fetch: overrides.gemini?.fetch,
      timeout: overrides.gemini?.timeout,
    });
  }

  return providers;
}

export function modelProviderEnvApiKeys(
  env: NodeJS.ProcessEnv,
): Partial<Record<ModelProvider, string | undefined>> {
  return {
    OPENAI: env.OPENAI_API_KEY?.trim(),
    ANTHROPIC: env.ANTHROPIC_API_KEY?.trim(),
    GOOGLE_GEMINI: env.GOOGLE_GEMINI_API_KEY?.trim(),
  };
}
