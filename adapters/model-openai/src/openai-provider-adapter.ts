import type {
  ModelConversationMessage,
  ModelToolCall,
} from "@osva-ai/contracts";
import { MODEL_ERROR_CODES, isCanonicalJsonValue } from "@osva-ai/contracts";
import {
  ModelGatewayError,
  type ModelProviderAdapter,
  type NormalizedModelUsage,
  type ProviderGenerateTextResult,
  type ResolvedProviderGenerateTextRequest,
} from "@osva/model-gateway";
import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseUsage,
} from "openai/resources/responses/responses";

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
  ): Promise<ProviderGenerateTextResult> {
    try {
      if (requiresChatCompletions(request)) {
        return await this.generateChatCompletion(request);
      }

      const params = toResponsesCreateParams(request);
      const response = await this.client.responses.create(params, {
        signal: request.signal,
      });
      return {
        text: normalizeRequiredOutputText(response.output_text),
        finishReason: "stop",
        usage: normalizeUsage(response.usage),
      };
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }

  private async generateChatCompletion(
    request: ResolvedProviderGenerateTextRequest,
  ): Promise<ProviderGenerateTextResult> {
    const messages = toChatCompletionMessages(request.messages);
    const response = await this.client.chat.completions.create(
      {
        model: request.model,
        messages,
        max_tokens: request.maxOutputTokens,
        tools:
          request.toolDefinitions === undefined ||
          request.toolDefinitions.length === 0
            ? undefined
            : request.toolDefinitions.map((tool) => ({
                type: "function" as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
        response_format:
          request.jsonSchema === undefined
            ? undefined
            : {
                type: "json_schema" as const,
                json_schema: {
                  name: "agent_output",
                  schema: request.jsonSchema,
                  strict: true,
                },
              },
      },
      { signal: request.signal },
    );

    const choice = response.choices[0];
    if (choice === undefined) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider returned no choices.",
      );
    }

    const toolCalls = normalizeOpenAiToolCalls(choice.message.tool_calls);
    const text = choice.message.content?.trim();
    const finishReason =
      toolCalls.length > 0
        ? ("tool_call" as const)
        : choice.finish_reason === "length"
          ? ("length" as const)
          : ("stop" as const);

    if (toolCalls.length === 0 && (text === undefined || text.length === 0)) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider returned no textual output.",
      );
    }

    return {
      text: text && text.length > 0 ? text : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: normalizeChatUsage(response.usage),
      providerRequestId: response.id,
      providerFinishReason: choice.finish_reason ?? undefined,
    };
  }
}

function requiresChatCompletions(
  request: ResolvedProviderGenerateTextRequest,
): boolean {
  if (request.jsonSchema !== undefined) {
    return true;
  }

  if (
    request.toolDefinitions !== undefined &&
    request.toolDefinitions.length > 0
  ) {
    return true;
  }

  return request.messages.some((message) => message.role === "tool");
}

function toChatCompletionMessages(
  messages: readonly ModelConversationMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const mapped: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      mapped.push({ role: "system", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      mapped.push({ role: "assistant", content: message.content });
      continue;
    }

    if (message.role === "tool") {
      mapped.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      });
      continue;
    }

    mapped.push({ role: "user", content: message.content });
  }

  return mapped;
}

function normalizeOpenAiToolCalls(
  toolCalls:
    OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
): readonly ModelToolCall[] {
  if (toolCalls === undefined || toolCalls.length === 0) {
    return [];
  }

  const normalized: ModelToolCall[] = [];
  for (const call of toolCalls) {
    if (call.type !== "function") {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(call.function.arguments);
    } catch {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider returned invalid tool arguments.",
      );
    }

    if (!isCanonicalJsonValue(parsed)) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider returned invalid tool arguments.",
      );
    }

    normalized.push({
      id: call.id,
      name: call.function.name,
      arguments: parsed,
    });
  }

  return normalized;
}

function normalizeChatUsage(
  usage: OpenAI.Completions.CompletionUsage | undefined,
): NormalizedModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function toResponsesCreateParams(
  request: ResolvedProviderGenerateTextRequest,
): ResponseCreateParamsNonStreaming {
  const systemContent = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input = request.messages
    .filter((message) => message.role !== "system" && message.role !== "tool")
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

function toResponseInputMessage(message: ModelConversationMessage): {
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

function normalizeRequiredOutputText(
  outputText: string | null | undefined,
): string {
  if (typeof outputText !== "string" || outputText.trim().length === 0) {
    throw new ModelGatewayError(
      MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
      "The model provider returned no textual output.",
    );
  }

  return outputText;
}

function normalizeUsage(
  usage: ResponseUsage | undefined,
): NormalizedModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cachedInputTokens:
      usage.input_tokens_details.cached_tokens > 0
        ? usage.input_tokens_details.cached_tokens
        : undefined,
  };
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

  if (error instanceof OpenAI.APIUserAbortError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_CANCELLED,
      "The model provider request was cancelled.",
      { provider: "openai", retryable: false },
    );
  }

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_REQUEST_TIMEOUT,
      "The model provider request timed out.",
      { provider: "openai", retryable: true },
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
