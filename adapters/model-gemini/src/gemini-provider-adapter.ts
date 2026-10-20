import type {
  ModelConversationMessage,
  ModelToolCall,
} from "@osva-ai/contracts";
import { MODEL_ERROR_CODES, isCanonicalJsonValue } from "@osva-ai/contracts";
import {
  ModelGatewayError,
  type ModelFinishReason,
  type ModelProviderAdapter,
  type NormalizedModelUsage,
  type ProviderGenerateTextResult,
  type ResolvedProviderGenerateTextRequest,
  splitSystemAndConversationMessages,
} from "@osva/model-gateway";

export const GEMINI_PROVIDER = "google-gemini" as const;

const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiProviderAdapterOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly fetch?: typeof fetch;
  readonly timeout?: number;
}

export class GeminiProviderAdapter implements ModelProviderAdapter {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeout: number | undefined;

  constructor(options: GeminiProviderAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseURL = (options.baseURL ?? DEFAULT_GEMINI_BASE_URL).replace(
      /\/$/,
      "",
    );
    this.fetchImpl = options.fetch ?? fetch;
    this.timeout = options.timeout;
  }

  async generateText(
    request: ResolvedProviderGenerateTextRequest,
  ): Promise<ProviderGenerateTextResult> {
    const body = toGeminiGenerateContentBody(request);
    const url = `${this.baseURL}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    try {
      const { response } = await fetchWithSignal(
        this.fetchImpl,
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
        request.signal,
        this.timeout,
      );
      const payload = (await response.json()) as GeminiGenerateContentResponse;

      if (!response.ok) {
        throw mapGeminiHttpError(response.status, payload);
      }

      return normalizeGeminiResponse(payload);
    } catch (error) {
      if (error instanceof ModelGatewayError) {
        throw error;
      }

      if (error instanceof FetchAbortError) {
        if (error.reason === "timeout") {
          throw new ModelGatewayError(
            MODEL_ERROR_CODES.MODEL_REQUEST_TIMEOUT,
            "The model provider request timed out.",
            { provider: GEMINI_PROVIDER, retryable: true },
          );
        }

        throw new ModelGatewayError(
          MODEL_ERROR_CODES.MODEL_CANCELLED,
          "The model provider request was cancelled.",
          { provider: GEMINI_PROVIDER, retryable: false },
        );
      }

      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        "The model provider request failed.",
        { provider: GEMINI_PROVIDER, retryable: true },
      );
    }
  }
}

interface GeminiGenerateContentBody {
  systemInstruction?: {
    parts: [{ text: string }];
  };
  contents: GeminiContent[];
  tools?: readonly [
    {
      functionDeclarations: readonly {
        name: string;
        description?: string;
        parameters: unknown;
      }[];
    },
  ];
  generationConfig?: {
    maxOutputTokens?: number;
    responseMimeType?: string;
    responseSchema?: unknown;
  };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | {
      functionCall: { name: string; args: Record<string, unknown> };
    }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    };

interface GeminiGenerateContentResponse {
  readonly responseId?: string;
  readonly candidates?: readonly GeminiCandidate[];
  readonly usageMetadata?: GeminiUsageMetadata;
  readonly error?: GeminiErrorBody;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
  finishReason?: string;
}

interface GeminiUsageMetadata {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly thoughtsTokenCount?: number;
  readonly totalTokenCount?: number;
}

interface GeminiErrorBody {
  readonly code?: number;
  readonly message?: string;
  readonly status?: string;
}

function toGeminiGenerateContentBody(
  request: ResolvedProviderGenerateTextRequest,
): GeminiGenerateContentBody {
  const { systemContent, conversation } = splitSystemAndConversationMessages(
    request.messages,
  );
  const body: GeminiGenerateContentBody = {
    contents: conversation.map(toGeminiContent),
  };

  if (systemContent.length > 0) {
    body.systemInstruction = { parts: [{ text: systemContent }] };
  }

  if (
    request.maxOutputTokens !== undefined ||
    request.jsonSchema !== undefined
  ) {
    body.generationConfig = {
      ...(request.maxOutputTokens !== undefined
        ? { maxOutputTokens: request.maxOutputTokens }
        : {}),
      ...(request.jsonSchema !== undefined
        ? {
            responseMimeType: "application/json",
            responseSchema: request.jsonSchema,
          }
        : {}),
    };
  }

  if (
    request.toolDefinitions !== undefined &&
    request.toolDefinitions.length > 0
  ) {
    body.tools = [
      {
        functionDeclarations: request.toolDefinitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })),
      },
    ];
  }

  return body;
}

function toGeminiContent(message: ModelConversationMessage): GeminiContent {
  if (message.role === "tool") {
    let response: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(message.content);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        response = { result: parsed };
      } else {
        response = parsed as Record<string, unknown>;
      }
    } catch {
      response = { result: message.content };
    }

    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: message.name,
            response,
          },
        },
      ],
    };
  }

  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  };
}

function normalizeGeminiResponse(
  payload: GeminiGenerateContentResponse,
): ProviderGenerateTextResult {
  const candidate = payload.candidates?.[0];
  if (candidate === undefined) {
    throw new ModelGatewayError(
      MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
      "The model provider returned no candidates.",
      { provider: GEMINI_PROVIDER, retryable: false },
    );
  }

  const toolCalls = normalizeGeminiToolCalls(candidate.content?.parts);
  const text = normalizeOptionalOutputText(candidate.content?.parts);
  const finish = normalizeGeminiFinishReason(candidate.finishReason);

  if (
    toolCalls.length === 0 &&
    (text === undefined || text.length === 0) &&
    finish.reason !== "blocked"
  ) {
    throw new ModelGatewayError(
      MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
      "The model provider returned no usable output.",
      { provider: GEMINI_PROVIDER, retryable: false },
    );
  }

  return {
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: normalizeUsage(payload.usageMetadata),
    finishReason:
      toolCalls.length > 0 && finish.reason === "stop"
        ? "tool_call"
        : finish.reason,
    providerFinishReason: finish.raw,
    providerRequestId: payload.responseId,
  };
}

function normalizeOptionalOutputText(
  parts: GeminiPart[] | undefined,
): string | undefined {
  const text = (parts ?? [])
    .filter((part): part is { text: string } => "text" in part)
    .map((part) => part.text)
    .join("")
    .trim();

  return text.length > 0 ? text : undefined;
}

function normalizeGeminiToolCalls(
  parts: GeminiPart[] | undefined,
): readonly ModelToolCall[] {
  const calls: ModelToolCall[] = [];

  for (const part of parts ?? []) {
    if (!("functionCall" in part)) {
      continue;
    }

    const args = part.functionCall.args;
    if (!isCanonicalJsonValue(args)) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider returned invalid tool arguments.",
        { provider: GEMINI_PROVIDER, retryable: false },
      );
    }

    calls.push({
      id: `${part.functionCall.name}-${calls.length + 1}`,
      name: part.functionCall.name,
      arguments: args,
    });
  }

  return calls;
}

function normalizeUsage(
  usage: GeminiUsageMetadata | undefined,
): NormalizedModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens =
    (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  const totalTokens =
    usage.totalTokenCount ?? Math.max(0, inputTokens + outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function normalizeGeminiFinishReason(finishReason: string | undefined): {
  readonly reason: ModelFinishReason;
  readonly raw: string | undefined;
} {
  switch (finishReason) {
    case "STOP":
      return { reason: "stop", raw: finishReason };
    case "MAX_TOKENS":
      return { reason: "length", raw: finishReason };
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "LANGUAGE":
      return { reason: "blocked", raw: finishReason };
    case "UNEXPECTED_TOOL_CALL":
      return { reason: "tool_call", raw: finishReason };
    case "MALFORMED_FUNCTION_CALL":
    case "OTHER":
      return { reason: "other", raw: finishReason };
    default:
      return { reason: "other", raw: finishReason };
  }
}

function mapGeminiHttpError(
  status: number,
  payload: GeminiGenerateContentResponse,
): ModelGatewayError {
  const message =
    payload.error?.message ?? "The model provider returned an error.";
  const statusName = payload.error?.status;

  if (status === 400) {
    if (statusName === "INVALID_ARGUMENT") {
      return new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
        "The model provider rejected the request.",
        {
          provider: GEMINI_PROVIDER,
          providerStatusCode: status,
          retryable: false,
        },
      );
    }

    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      message,
      {
        provider: GEMINI_PROVIDER,
        providerStatusCode: status,
        retryable: false,
      },
    );
  }

  if (status === 401 || status === 403) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      "The model provider rejected the request credentials.",
      {
        provider: GEMINI_PROVIDER,
        providerStatusCode: status,
        retryable: false,
      },
    );
  }

  if (status === 404) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_NOT_FOUND,
      "The configured model was not found at the provider.",
      {
        provider: GEMINI_PROVIDER,
        providerStatusCode: status,
        retryable: false,
      },
    );
  }

  if (status === 429) {
    const quotaExhausted =
      statusName === "RESOURCE_EXHAUSTED" &&
      message.toLowerCase().includes("quota");
    return new ModelGatewayError(
      quotaExhausted
        ? MODEL_ERROR_CODES.MODEL_QUOTA_EXHAUSTED
        : MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
      quotaExhausted
        ? "The model provider quota is exhausted."
        : "The model provider rate-limited the request.",
      {
        provider: GEMINI_PROVIDER,
        providerStatusCode: status,
        retryable: !quotaExhausted,
      },
    );
  }

  if (
    statusName === "SAFETY" ||
    message.toLowerCase().includes("blocked") ||
    message.toLowerCase().includes("safety")
  ) {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_CONTENT_BLOCKED,
      "The model provider blocked the request or response.",
      {
        provider: GEMINI_PROVIDER,
        providerStatusCode: status,
        retryable: false,
      },
    );
  }

  if (status === 503 || statusName === "UNAVAILABLE") {
    return new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      "The model provider is temporarily unavailable.",
      {
        provider: GEMINI_PROVIDER,
        providerStatusCode: status,
        retryable: true,
      },
    );
  }

  return new ModelGatewayError(
    MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
    message,
    {
      provider: GEMINI_PROVIDER,
      providerStatusCode: status,
      retryable: status >= 500,
    },
  );
}

class FetchAbortError extends Error {
  readonly reason: "caller" | "timeout";

  constructor(reason: "caller" | "timeout") {
    super(
      reason === "timeout"
        ? "The model provider request timed out."
        : "The model provider request was cancelled.",
    );
    this.name = "FetchAbortError";
    this.reason = reason;
  }
}

async function fetchWithSignal(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeout: number | undefined,
): Promise<{ readonly response: Response; readonly abortReason?: never }> {
  const controller = new AbortController();
  if (signal?.aborted === true) {
    throw new FetchAbortError("caller");
  }

  let abortReason: "caller" | "timeout" | undefined;
  const onAbort = () => {
    abortReason = "caller";
    controller.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeout !== undefined) {
    timeoutId = setTimeout(() => {
      abortReason = "timeout";
      controller.abort();
    }, timeout);
  }

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    return { response };
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new FetchAbortError(abortReason ?? "caller");
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted"))
  );
}
