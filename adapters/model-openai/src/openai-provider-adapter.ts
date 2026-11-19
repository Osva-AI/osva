import type {
  ModelConversationMessage,
  ModelStreamEvent,
  ModelToolCall,
} from "@osva-ai/contracts";
import {
  INFERENCE_MODEL_INVOCATION_SOURCES,
  MODEL_ERROR_CODES,
  isCanonicalJsonValue,
} from "@osva-ai/contracts";
import type { ModelStreamEventSource } from "@osva-ai/contracts";
import {
  ModelGatewayError,
  ModelStreamSession,
  type ModelFinishReason,
  type ModelGatewayErrorOptions,
  type ModelProviderAdapter,
  type ProviderGenerateTextResult,
  type ResolvedProviderGenerateTextRequest,
  toModelStreamUsage,
} from "@osva/model-gateway";
import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

import {
  buildProviderInvocationMetadata,
  mapOpenAiChatFinishReason,
  normalizeOpenAiChatCompletionUsage,
  normalizeOpenAiResponsesUsage,
  sanitizeProviderModelId,
} from "./openai-usage.js";

export const OPENAI_PROVIDER = "openai" as const;

/**
 * Official OpenAI Node SDK default maxRetries is 2. Those retries stay inside
 * one generateText call and must not become OSVA RunAttempts. OSVA does not
 * add a provider retry policy or fallback.
 */
export const OPENAI_SDK_MAX_RETRIES = 2;

/**
 * Connection-resolved adapters disable hidden SDK retries so one gateway call
 * maps to one observable provider HTTP attempt (budget accounting).
 */
export const OPENAI_CONNECTION_RESOLVED_MAX_RETRIES = 0;

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

  generateCompletionStream(
    request: ResolvedProviderGenerateTextRequest,
  ): ModelStreamEventSource {
    return {
      [Symbol.asyncIterator]: () =>
        iterateOpenAICompletionStream(this.client, request),
    };
  }

  async generateText(
    request: ResolvedProviderGenerateTextRequest,
  ): Promise<ProviderGenerateTextResult> {
    try {
      if (openAIRequiresChatCompletions(request)) {
        return await this.generateChatCompletion(request);
      }

      const params = toResponsesCreateParams(request);
      const response = await this.client.responses.create(params, {
        signal: request.signal,
      });
      const reportedModel = sanitizeProviderModelId(response.model);
      return {
        text: normalizeRequiredOutputText(response.output_text),
        finishReason: "stop",
        usage: normalizeOpenAiResponsesUsage(response.usage),
        providerRequestId: sanitizeProviderToken(response.id),
        invocation: buildProviderInvocationMetadata(
          request.model,
          reportedModel,
        ),
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
    const finish = mapOpenAiChatFinishReason({
      toolCallCount: toolCalls.length,
      choiceFinishReason: choice.finish_reason,
    });

    if (toolCalls.length === 0 && (text === undefined || text.length === 0)) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider returned no textual output.",
      );
    }

    const reportedModel = sanitizeProviderModelId(response.model);
    return {
      text: text && text.length > 0 ? text : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: finish.finishReason,
      usage: normalizeOpenAiChatCompletionUsage(response.usage),
      providerRequestId: sanitizeProviderToken(response.id),
      providerFinishReason: finish.providerFinishReason,
      invocation: buildProviderInvocationMetadata(request.model, reportedModel),
    };
  }
}

export function openAIRequiresChatCompletions(
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

export function mapOpenAIError(error: unknown): ModelGatewayError {
  if (error instanceof ModelGatewayError) {
    return error;
  }

  if (error instanceof OpenAI.AuthenticationError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      "The model provider rejected the request credentials.",
      {
        ...openAiErrorMetadata(error),
        retryable: false,
      },
    );
  }

  if (error instanceof OpenAI.RateLimitError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
      "The model provider rate-limited the request.",
      {
        ...openAiErrorMetadata(error),
        retryable: true,
        retryAfterMs: parseRetryAfterMs(error.headers),
      },
    );
  }

  if (error instanceof OpenAI.PermissionDeniedError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      "The model provider denied permission for the request.",
      {
        ...openAiErrorMetadata(error),
        retryable: false,
      },
    );
  }

  if (error instanceof OpenAI.NotFoundError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_NOT_FOUND,
      "The configured model was not found at the provider.",
      {
        ...openAiErrorMetadata(error),
        retryable: false,
      },
    );
  }

  if (error instanceof OpenAI.BadRequestError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      "The model provider rejected the request.",
      {
        ...openAiErrorMetadata(error),
        retryable: false,
      },
    );
  }

  if (error instanceof OpenAI.APIUserAbortError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_CANCELLED,
      "The model provider request was cancelled.",
      { provider: OPENAI_PROVIDER, retryable: false },
    );
  }

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_REQUEST_TIMEOUT,
      "The model provider request timed out.",
      { provider: OPENAI_PROVIDER, retryable: true },
    );
  }

  if (error instanceof OpenAI.InternalServerError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider is temporarily unavailable.",
      {
        ...openAiErrorMetadata(error),
        retryable: true,
      },
    );
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider request failed.",
      { provider: OPENAI_PROVIDER, retryable: true },
    );
  }

  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) {
      return new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
        "The model provider rate-limited the request.",
        {
          ...openAiErrorMetadata(error),
          retryable: true,
          retryAfterMs: parseRetryAfterMs(error.headers),
        },
      );
    }
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider returned an error.",
      {
        ...openAiErrorMetadata(error),
        retryable: error.status >= 500,
      },
    );
  }

  return new ModelGatewayError(
    MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
    "The model provider request failed.",
    { provider: OPENAI_PROVIDER, retryable: false },
  );
}

type OpenAiApiError = InstanceType<typeof OpenAI.APIError>;

function openAiErrorMetadata(
  error: OpenAiApiError,
): Pick<
  ModelGatewayErrorOptions,
  | "provider"
  | "providerStatusCode"
  | "providerRequestId"
  | "providerErrorType"
  | "providerErrorCode"
  | "providerErrorParam"
> {
  const body = parseOpenAiErrorBody(error);
  const requestId = sanitizeProviderToken(
    error.headers?.get("x-request-id") ?? undefined,
  );

  return {
    provider: OPENAI_PROVIDER,
    providerStatusCode: error.status,
    providerRequestId: requestId,
    providerErrorType: body.type,
    providerErrorCode: body.code,
    providerErrorParam: body.param,
  };
}

function parseOpenAiErrorBody(error: OpenAiApiError): {
  readonly type: string | undefined;
  readonly code: string | undefined;
  readonly param: string | undefined;
} {
  const raw = error.error;
  if (raw === null || typeof raw !== "object") {
    return { type: undefined, code: undefined, param: undefined };
  }

  const record = raw as Record<string, unknown>;
  const nested =
    record.error !== null && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : record;

  return {
    type: sanitizeProviderToken(readStringField(nested, "type")),
    code: sanitizeProviderToken(readStringField(nested, "code")),
    param: sanitizeProviderToken(readStringField(nested, "param")),
  };
}

function readStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function parseRetryAfterMs(headers: Headers | undefined): number | undefined {
  const raw = headers?.get("retry-after")?.trim();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const when = Date.parse(raw);
  if (Number.isNaN(when)) {
    return undefined;
  }

  return Math.max(0, when - Date.now());
}

function sanitizeProviderToken(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return undefined;
  }

  if (!/^[A-Za-z0-9_.:-]+$/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

async function* iterateOpenAICompletionStream(
  client: OpenAI,
  request: ResolvedProviderGenerateTextRequest,
): AsyncGenerator<ModelStreamEvent> {
  const session = new ModelStreamSession();
  let yielded = false;
  try {
    if (openAIRequiresChatCompletions(request)) {
      yield* streamOpenAIChat(client, request, session);
    } else {
      yield* streamOpenAIResponses(client, request, session);
    }
  } catch (error) {
    if (!yielded) {
      throw mapOpenAIError(error);
    }
    const mapped =
      error instanceof ModelGatewayError ? error : mapOpenAIError(error);
    yield session.failed(mapped);
  }

  async function* streamOpenAIChat(
    chatClient: OpenAI,
    chatRequest: ResolvedProviderGenerateTextRequest,
    chatSession: ModelStreamSession,
  ): AsyncGenerator<ModelStreamEvent> {
    const messages = toChatCompletionMessages(chatRequest.messages);
    const stream = await chatClient.chat.completions.create(
      {
        model: chatRequest.model,
        messages,
        max_tokens: chatRequest.maxOutputTokens,
        tools:
          chatRequest.toolDefinitions === undefined ||
          chatRequest.toolDefinitions.length === 0
            ? undefined
            : chatRequest.toolDefinitions.map((tool) => ({
                type: "function" as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
        response_format:
          chatRequest.jsonSchema === undefined
            ? undefined
            : {
                type: "json_schema" as const,
                json_schema: {
                  name: "agent_output",
                  schema: chatRequest.jsonSchema,
                  strict: true,
                },
              },
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: chatRequest.signal },
    );

    let providerRequestId: string | undefined;
    let finishReason: ModelFinishReason = "other";
    const toolStarts = new Set<number>();

    for await (const chunk of stream) {
      yielded = true;
      providerRequestId = sanitizeProviderToken(chunk.id) ?? providerRequestId;
      const choice = chunk.choices[0];
      if (choice === undefined) {
        continue;
      }

      const delta = choice.delta;
      if (
        delta?.content !== undefined &&
        delta.content !== null &&
        delta.content.length > 0
      ) {
        yield chatSession.textDelta(delta.content);
      }

      if (delta?.tool_calls !== undefined) {
        for (const toolDelta of delta.tool_calls) {
          const index = toolDelta.index ?? 0;
          if (
            toolDelta.id !== undefined &&
            toolDelta.function?.name !== undefined &&
            !toolStarts.has(index)
          ) {
            toolStarts.add(index);
            yield chatSession.toolCallStart(
              index,
              toolDelta.id,
              toolDelta.function.name,
            );
          }
          if (toolDelta.function?.arguments !== undefined) {
            yield chatSession.toolCallArgumentsDelta(
              index,
              toolDelta.function.arguments,
            );
          }
        }
      }

      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        finishReason = mapOpenAiChatFinishReason({
          toolCallCount: toolStarts.size,
          choiceFinishReason: choice.finish_reason,
        }).finishReason;
      }

      if (chunk.usage !== undefined && chunk.usage !== null) {
        const usage = normalizeOpenAiChatCompletionUsage(chunk.usage);
        if (usage !== undefined && usage.incomplete !== true) {
          yield chatSession.usageFinal(
            toModelStreamUsage(usage),
            INFERENCE_MODEL_INVOCATION_SOURCES[0],
            providerRequestId,
          );
        }
      }
    }

    yield chatSession.completed(finishReason, providerRequestId);
  }

  async function* streamOpenAIResponses(
    responsesClient: OpenAI,
    responsesRequest: ResolvedProviderGenerateTextRequest,
    responsesSession: ModelStreamSession,
  ): AsyncGenerator<ModelStreamEvent> {
    const params = {
      ...toResponsesCreateParams(responsesRequest),
      stream: true as const,
    };
    const stream = await responsesClient.responses.create(params, {
      signal: responsesRequest.signal,
    });

    let providerRequestId: string | undefined;
    const outputIndexToToolIndex = new Map<number, number>();
    let nextToolIndex = 0;

    for await (const event of stream) {
      yielded = true;
      switch (event.type) {
        case "response.output_text.delta": {
          if (event.delta.length > 0) {
            yield responsesSession.textDelta(event.delta);
          }
          break;
        }
        case "response.output_item.added": {
          const item = event.item;
          if (item.type === "function_call") {
            const toolIndex = nextToolIndex;
            nextToolIndex += 1;
            outputIndexToToolIndex.set(event.output_index, toolIndex);
            yield responsesSession.toolCallStart(
              toolIndex,
              item.call_id ?? item.id ?? `call_${String(toolIndex)}`,
              item.name,
            );
          }
          break;
        }
        case "response.function_call_arguments.delta": {
          const toolIndex = outputIndexToToolIndex.get(event.output_index);
          if (toolIndex !== undefined) {
            yield responsesSession.toolCallArgumentsDelta(
              toolIndex,
              event.delta,
            );
          }
          break;
        }
        case "response.completed": {
          providerRequestId =
            sanitizeProviderToken(event.response.id) ?? providerRequestId;
          if (event.response.status === "failed") {
            yield responsesSession.failed(
              new ModelGatewayError(
                MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
                "The model provider returned an incomplete response.",
                { retryable: false },
              ),
            );
            return;
          }
          const usage = normalizeOpenAiResponsesUsage(event.response.usage);
          if (usage !== undefined && usage.incomplete !== true) {
            yield responsesSession.usageFinal(
              toModelStreamUsage(usage),
              INFERENCE_MODEL_INVOCATION_SOURCES[0],
              providerRequestId,
            );
          }
          const finishReason: ModelFinishReason =
            event.response.status === "incomplete" ? "length" : "stop";
          yield responsesSession.completed(finishReason, providerRequestId);
          return;
        }
        case "response.failed":
        case "response.incomplete": {
          yield responsesSession.failed(
            new ModelGatewayError(
              MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
              "The model provider returned an incomplete response.",
              { retryable: false },
            ),
          );
          return;
        }
        default:
          break;
      }
    }

    yield responsesSession.failed(
      new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider stream ended without a terminal response.",
        { retryable: false },
      ),
    );
  }
}
