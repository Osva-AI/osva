import type { ModelTextMessage } from "@osva/contracts";
import { MODEL_ERROR_CODES } from "@osva/contracts";
import {
  ModelGatewayError,
  type ModelFinishReason,
  type ModelProviderAdapter,
  type NormalizedModelUsage,
  type ProviderGenerateTextResult,
  type ResolvedProviderGenerateTextRequest,
  splitSystemAndConversationMessages,
} from "@osva/model-gateway";
import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Usage,
} from "@anthropic-ai/sdk/resources/messages/messages";

export const ANTHROPIC_PROVIDER = "anthropic" as const;

/**
 * Official Anthropic Node SDK default maxRetries is 2. OSVA disables SDK
 * retries so one generateText call is one observable provider attempt.
 */
export const ANTHROPIC_SDK_MAX_RETRIES = 0;

export interface AnthropicProviderAdapterOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly fetch?: typeof fetch;
  readonly maxRetries?: number;
  readonly timeout?: number;
}

export class AnthropicProviderAdapter implements ModelProviderAdapter {
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderAdapterOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      fetch: options.fetch,
      maxRetries: options.maxRetries ?? ANTHROPIC_SDK_MAX_RETRIES,
      timeout: options.timeout,
    });
  }

  async generateText(
    request: ResolvedProviderGenerateTextRequest,
  ): Promise<ProviderGenerateTextResult> {
    const params = toAnthropicCreateParams(request);

    try {
      const response = await this.client.messages.create(params, {
        signal: request.signal,
      });
      return normalizeAnthropicResponse(response);
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}

function toAnthropicCreateParams(
  request: ResolvedProviderGenerateTextRequest,
): MessageCreateParamsNonStreaming {
  const { systemContent, conversation } = splitSystemAndConversationMessages(
    request.messages,
  );
  const params: MessageCreateParamsNonStreaming = {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? 1024,
    messages: conversation.map(toAnthropicMessage),
  };

  if (systemContent.length > 0) {
    params.system = systemContent;
  }

  return params;
}

function toAnthropicMessage(message: ModelTextMessage): MessageParam {
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  };
}

function normalizeAnthropicResponse(
  message: Message,
): ProviderGenerateTextResult {
  const text = normalizeOutputText(message.content);
  const finish = normalizeAnthropicFinishReason(message.stop_reason);

  return {
    text,
    usage: normalizeUsage(message.usage),
    finishReason: finish.reason,
    providerFinishReason: finish.raw,
    providerRequestId: message.id,
  };
}

function normalizeOutputText(content: Message["content"]): string {
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  if (text.length === 0) {
    const unsupported = content.some((block) => block.type !== "text");
    throw new ModelGatewayError(
      MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
      unsupported
        ? "The model provider returned unsupported output types."
        : "The model provider returned no textual output.",
      { provider: ANTHROPIC_PROVIDER, retryable: false },
    );
  }

  return text;
}

function normalizeUsage(
  usage: Usage | undefined,
): NormalizedModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const totalTokens = inputTokens + outputTokens;

  const cachedInputTokens = usage.cache_read_input_tokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: cachedInputTokens > 0 ? cachedInputTokens : undefined,
  };
}

function normalizeAnthropicFinishReason(
  stopReason: Message["stop_reason"] | null,
): { readonly reason: ModelFinishReason; readonly raw: string | undefined } {
  const raw = stopReason ?? undefined;

  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return { reason: "stop", raw };
    case "max_tokens":
      return { reason: "length", raw };
    case "refusal":
      return { reason: "blocked", raw };
    case "tool_use":
      return { reason: "tool_call", raw };
    case "pause_turn":
      return { reason: "other", raw };
    default:
      if (String(raw) === "model_context_window_exceeded") {
        return { reason: "length", raw };
      }
      return { reason: "other", raw };
  }
}

function mapAnthropicError(error: unknown): ModelGatewayError {
  if (error instanceof ModelGatewayError) {
    return error;
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      "The model provider rejected the request credentials.",
      {
        provider: ANTHROPIC_PROVIDER,
        providerStatusCode: error.status,
        retryable: false,
      },
    );
  }

  if (error instanceof Anthropic.PermissionDeniedError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      "The model provider denied permission for the request.",
      {
        provider: ANTHROPIC_PROVIDER,
        providerStatusCode: error.status,
        retryable: false,
      },
    );
  }

  if (error instanceof Anthropic.RateLimitError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
      "The model provider rate-limited the request.",
      {
        provider: ANTHROPIC_PROVIDER,
        providerStatusCode: error.status,
        retryable: true,
        retryAfterMs: parseRetryAfterMs(error.headers),
      },
    );
  }

  if (error instanceof Anthropic.NotFoundError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_NOT_FOUND,
      "The configured model was not found at the provider.",
      {
        provider: ANTHROPIC_PROVIDER,
        providerStatusCode: error.status,
        retryable: false,
      },
    );
  }

  if (error instanceof Anthropic.BadRequestError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      "The model provider rejected the request.",
      {
        provider: ANTHROPIC_PROVIDER,
        providerStatusCode: error.status,
        retryable: false,
      },
    );
  }

  if (error instanceof Anthropic.APIUserAbortError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_CANCELLED,
      "The model provider request was cancelled.",
      { provider: ANTHROPIC_PROVIDER, retryable: false },
    );
  }

  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_REQUEST_TIMEOUT,
      "The model provider request timed out.",
      { provider: ANTHROPIC_PROVIDER, retryable: true },
    );
  }

  if (error instanceof Anthropic.InternalServerError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider is temporarily unavailable.",
      {
        provider: ANTHROPIC_PROVIDER,
        providerStatusCode: error.status,
        retryable: true,
      },
    );
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider request failed.",
      { provider: ANTHROPIC_PROVIDER, retryable: true },
    );
  }

  if (error instanceof Anthropic.APIError) {
    if (error.status === 529) {
      return new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        "The model provider is overloaded.",
        {
          provider: ANTHROPIC_PROVIDER,
          providerStatusCode: error.status,
          retryable: true,
        },
      );
    }

    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider returned an error.",
      {
        provider: ANTHROPIC_PROVIDER,
        providerStatusCode: error.status,
        retryable: error.status >= 500,
      },
    );
  }

  return new ModelGatewayError(
    MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
    "The model provider request failed.",
    { provider: ANTHROPIC_PROVIDER, retryable: false },
  );
}

function parseRetryAfterMs(headers: Headers | undefined): number | undefined {
  const value = headers?.get("retry-after");
  if (value === null || value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}
