import type { ModelProvider } from "@osva-ai/contracts";
import { AnthropicBatchProvider } from "@osva/adapters-model-anthropic";
import { GeminiBatchProvider } from "@osva/adapters-model-gemini";
import { OpenAIBatchProvider } from "@osva/adapters-model-openai";
import type { BatchInferenceProviderAdapter } from "@osva/model-gateway";

export interface ResolvedBatchInferenceConnection {
  readonly provider: ModelProvider;
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly fetch?: typeof fetch;
  readonly timeout?: number;
}

export function createBatchInferenceProviderAdapter(
  connection: ResolvedBatchInferenceConnection,
): BatchInferenceProviderAdapter {
  switch (connection.provider) {
    case "OPENAI":
      return new OpenAIBatchProvider({
        apiKey: connection.apiKey,
        baseURL: connection.baseURL,
        fetch: connection.fetch,
        timeout: connection.timeout,
      });
    case "ANTHROPIC":
      return new AnthropicBatchProvider({
        apiKey: connection.apiKey,
        baseURL: connection.baseURL,
        fetch: connection.fetch,
        timeout: connection.timeout,
      });
    case "GOOGLE_GEMINI":
      return new GeminiBatchProvider({
        apiKey: connection.apiKey,
        baseURL: connection.baseURL,
        fetch: connection.fetch,
        timeout: connection.timeout,
      });
    default: {
      const exhaustive: never = connection.provider;
      throw new Error(`unsupported batch provider ${exhaustive}`);
    }
  }
}
