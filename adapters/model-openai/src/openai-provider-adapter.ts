import type { GenerateTextResult, ModelTextMessage } from "@osva/contracts";
import { MODEL_ERROR_CODES } from "@osva/contracts";
import {
  ModelGatewayError,
  type ModelProviderAdapter,
  type ResolvedProviderGenerateTextRequest,
} from "@osva/model-gateway";
import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

/**
 * Official OpenAI Node SDK default maxRetries is 2. Those retries stay inside
 * one generateText call and must not become OSVA RunAttempts. OSVA does not
 * add a provider retry policy or fallback.
 */
export const OPENAI_SDK_MAX_RETRIES = 2;

export interface OpenAIProviderAdapterOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly fetch?: typeof fetch;
  readonly maxRetries?: number;
  readonly timeout?: number;
}

export class OpenAIProviderAdapter implements ModelProviderAdapter {
  private readonly client: OpenAI;

  constructor(options: OpenAIProviderAdapterOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      fetch: options.fetch,
      maxRetries: options.maxRetries ?? OPENAI_SDK_MAX_RETRIES,
      timeout: options.timeout,
    });
  }

  async generateText(
    request: ResolvedProviderGenerateTextRequest,
  ): Promise<GenerateTextResult> {
    const params = toResponsesCreateParams(request);

    try {
      const response = await this.client.responses.create(params, {
        signal: request.signal,
      });
      return normalizeOutputText(response.output_text);
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }
}

function toResponsesCreateParams(
  request: ResolvedProviderGenerateTextRequest,
): ResponseCreateParamsNonStreaming {
  const systemContent = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input = request.messages
    .filter((message) => message.role !== "system")
    .map(toResponseInputMessage);

  const params: ResponseCreateParamsNonStreaming = {
    model: request.model,
    input: input.length > 0 ? input : [],
    store: false,
  };

  if (systemContent.length > 0) {
    params.instructions = systemContent;
  }

  if (request.maxOutputTokens !== undefined) {
    params.max_output_tokens = request.maxOutputTokens;
  }

  return params;
}

function toResponseInputMessage(message: ModelTextMessage): {
  readonly type: "message";
  readonly role: "user" | "assistant";
  readonly content: string;
} {
  return {
    type: "message",
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  };
}

function normalizeOutputText(outputText: string | null | undefined): {
  readonly text: string;
} {
  if (typeof outputText !== "string" || outputText.trim().length === 0) {
    throw new ModelGatewayError(
      MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
      "The model provider returned no textual output.",
    );
  }

  return { text: outputText };
}

function mapOpenAIError(error: unknown): ModelGatewayError {
  if (error instanceof ModelGatewayError) {
    return error;
  }

  if (error instanceof OpenAI.AuthenticationError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      "The model provider rejected the request credentials.",
    );
  }

  if (error instanceof OpenAI.RateLimitError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
      "The model provider rate-limited the request.",
    );
  }

  if (
    error instanceof OpenAI.APIUserAbortError ||
    error instanceof OpenAI.APIConnectionTimeoutError
  ) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_REQUEST_TIMEOUT,
      "The model provider request timed out.",
    );
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider request failed.",
    );
  }

  if (error instanceof OpenAI.APIError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider returned an error.",
    );
  }

  return new ModelGatewayError(
    MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
    "The model provider request failed.",
  );
}
