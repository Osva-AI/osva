import type { ModelToolCall } from "@osva-ai/contracts";
import { MODEL_ERROR_CODES, isCanonicalJsonValue } from "@osva-ai/contracts";
import {
  ModelGatewayError,
  type ModelFinishReason,
  type ModelProviderAdapter,
  type NormalizedModelUsage,
  type ProviderGenerateTextResult,
  type ResolvedProviderGenerateTextRequest,
} from "@osva/model-gateway";
import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  Usage,
} from "@anthropic-ai/sdk/resources/messages/messages";

import { buildAnthropicMessagesCreateBody } from "./anthropic-messages-create-body.js";
import { anthropicErrorMetadata } from "./anthropic-provider-error-metadata.js";
import { emitAnthropicOperatorHttpDiagnostic } from "./anthropic-operator-http-diagnostic.js";
import { isAnthropicProviderErrorDiagnosticsEnabled } from "./anthropic-provider-error-fingerprint.js";

export const ANTHROPIC_PROVIDER = "anthropic" as const;

/**
 * Official Anthropic Node SDK default maxRetries is 2. OSVA disables SDK
 * retries so one generateText call is one observable provider attempt.
 */
export const ANTHROPIC_SDK_MAX_RETRIES = 0;

/** Structured outputs (`output_config`) require a current Messages API version. */
export const ANTHROPIC_MESSAGES_API_VERSION = "2026-10-21" as const;

export interface AnthropicProviderAdapterOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly fetch?: typeof fetch;
  readonly maxRetries?: number;
  readonly timeout?: number;
  /** Anthropic Console workspace id for multi-workspace / identity-linked keys. */
  readonly anthropicWorkspaceId?: string;
}

export class AnthropicProviderAdapter implements ModelProviderAdapter {
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderAdapterOptions) {
    const workspaceId = options.anthropicWorkspaceId?.trim();
    const defaultHeaders: Record<string, string> = {
      "anthropic-version": ANTHROPIC_MESSAGES_API_VERSION,
    };
    if (workspaceId !== undefined && workspaceId.length > 0) {
      defaultHeaders["anthropic-workspace-id"] = workspaceId;
    }

    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      fetch: options.fetch,
      maxRetries: options.maxRetries ?? ANTHROPIC_SDK_MAX_RETRIES,
      timeout: options.timeout,
      defaultHeaders,
    });
  }

  async generateText(
    request: ResolvedProviderGenerateTextRequest,
  ): Promise<ProviderGenerateTextResult> {
    const params = buildAnthropicMessagesCreateBody(request);

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

function normalizeAnthropicResponse(
  message: Message,
): ProviderGenerateTextResult {
  const toolCalls = normalizeToolCalls(message.content);
  const text = normalizeOptionalOutputText(message.content);
  const finish = normalizeAnthropicFinishReason(message.stop_reason);

  if (
    toolCalls.length === 0 &&
    (text === undefined || text.length === 0) &&
    finish.reason !== "blocked"
  ) {
    throw new ModelGatewayError(
      MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
      "The model provider returned no usable output.",
      { provider: ANTHROPIC_PROVIDER, retryable: false },
    );
  }

  return {
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: normalizeUsage(message.usage),
    finishReason: finish.reason,
    providerFinishReason: finish.raw,
    providerRequestId: message.id,
  };
}

function normalizeOptionalOutputText(
  content: Message["content"],
): string | undefined {
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return text.length > 0 ? text : undefined;
}

function normalizeToolCalls(
  content: Message["content"],
): readonly ModelToolCall[] {
  const calls: ModelToolCall[] = [];

  for (const block of content) {
    if (block.type !== "tool_use") {
      continue;
    }

    if (!isCanonicalJsonValue(block.input)) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider returned invalid tool arguments.",
        { provider: ANTHROPIC_PROVIDER, retryable: false },
      );
    }

    calls.push({
      id: block.id,
      name: block.name,
      arguments: block.input,
    });
  }

  return calls;
}

function normalizeUsage(
  usage: Usage | undefined,
): NormalizedModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const inputTokens = usage.input_tokens;
  // `output_tokens` is the inclusive billed total (thinking is a breakdown only).
  const outputTokens = usage.output_tokens;
  const cachedInputTokens = usage.cache_read_input_tokens ?? 0;
  const totalTokens = inputTokens + outputTokens;

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
        ...anthropicErrorMetadata(error),
        retryable: false,
      },
    );
  }

  if (error instanceof Anthropic.PermissionDeniedError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      "The model provider denied permission for the request.",
      {
        ...anthropicErrorMetadata(error),
        retryable: false,
      },
    );
  }

  if (error instanceof Anthropic.RateLimitError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
      "The model provider rate-limited the request.",
      {
        ...anthropicErrorMetadata(error),
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
        ...anthropicErrorMetadata(error),
        retryable: false,
      },
    );
  }

  if (error instanceof Anthropic.BadRequestError) {
    const metadata = anthropicErrorMetadata(error);
    if (isAnthropicProviderErrorDiagnosticsEnabled()) {
      emitAnthropicOperatorHttpDiagnostic(
        (line) => process.stderr.write(line),
        metadata,
      );
    }
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      "The model provider rejected the request.",
      {
        ...metadata,
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
        ...anthropicErrorMetadata(error),
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
          ...anthropicErrorMetadata(error),
          retryable: true,
        },
      );
    }

    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider returned an error.",
      {
        ...anthropicErrorMetadata(error),
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
