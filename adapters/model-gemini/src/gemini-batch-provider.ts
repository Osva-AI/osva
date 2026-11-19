import type { GenerateCompletionInput } from "@osva-ai/contracts";
import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import {
  type BatchInferenceProviderAdapter,
  type BatchInferenceProviderItemResult,
  type BatchInferenceProviderResultsPage,
  type BatchInferenceProviderSubmitRequest,
  type BatchInferenceProviderSubmitResult,
  type BatchInferenceProviderStatusResult,
  mapGeminiBatchStatus,
  splitSystemAndConversationMessages,
  toModelStreamUsage,
} from "@osva/model-gateway";

import { normalizeGeminiGenerateContentUsage } from "./gemini-usage.js";
import { normalizeGeminiProviderBaseUrl } from "./gemini-api-base-url.js";

const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiBatchProviderOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly fetch?: typeof fetch;
  readonly timeout?: number;
}

export class GeminiBatchProvider implements BatchInferenceProviderAdapter {
  readonly provider = "GOOGLE_GEMINI" as const;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeout: number | undefined;

  constructor(options: GeminiBatchProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseURL = normalizeGeminiProviderBaseUrl(
      options.baseURL ?? DEFAULT_GEMINI_BASE_URL,
    );
    this.fetchImpl = options.fetch ?? fetch;
    this.timeout = options.timeout;
  }

  checkCapabilities(): { supported: boolean; reasons: readonly string[] } {
    return { supported: true, reasons: [] };
  }

  async submit(
    request: BatchInferenceProviderSubmitRequest,
  ): Promise<BatchInferenceProviderSubmitResult> {
    const body = {
      batch: {
        model: `models/${request.providerModelId}`,
        requests: request.items.map((item) => ({
          request_id: item.providerCorrelationId,
          generateContentRequest: toGeminiGenerateBody(item.input),
        })),
      },
    };

    const response = await this.postJson(
      `/models/${encodeURIComponent(request.providerModelId)}:batchGenerateContent`,
      body,
    );
    const batch = response as { name?: string; state?: string };
    return {
      providerBatchId: batch.name ?? "unknown",
      providerJobStatus: mapGeminiBatchStatus(
        batch.state ?? "BATCH_STATE_PENDING",
      ),
    };
  }

  async getStatus(
    providerBatchId: string,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderStatusResult> {
    const response = await this.getJson(
      `/${encodeURIComponent(providerBatchId)}`,
      options?.abortSignal,
    );
    const batch = response as { name?: string; state?: string };
    return {
      providerBatchId: batch.name ?? providerBatchId,
      providerJobStatus: mapGeminiBatchStatus(batch.state ?? "UNKNOWN"),
    };
  }

  async requestCancellation(
    providerBatchId: string,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderStatusResult> {
    const response = await this.postJson(
      `/${encodeURIComponent(providerBatchId)}:cancel`,
      {},
      options?.abortSignal,
    );
    const batch = response as { name?: string; state?: string };
    return {
      providerBatchId: batch.name ?? providerBatchId,
      providerJobStatus: mapGeminiBatchStatus(
        batch.state ?? "BATCH_STATE_CANCELLED",
      ),
    };
  }

  async fetchResults(
    providerBatchId: string,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderResultsPage> {
    const response = await this.getJson(
      `/${encodeURIComponent(providerBatchId)}/results`,
      options?.abortSignal,
    );
    const rows = (response as { responses?: unknown[] }).responses ?? [];
    const items = rows.map((row) => mapGeminiBatchResultRow(row));
    return { items, done: true };
  }

  private async postJson(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = `${this.baseURL}${path}?key=${encodeURIComponent(this.apiKey)}`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
      ...(this.timeout !== undefined
        ? { signal: AbortSignal.timeout(this.timeout) }
        : {}),
    });
    if (!response.ok) {
      throw new Error(`gemini batch http ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }

  private async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const url = `${this.baseURL}${path}?key=${encodeURIComponent(this.apiKey)}`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      signal,
    });
    if (!response.ok) {
      throw new Error(`gemini batch http ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }
}

function toGeminiGenerateBody(input: GenerateCompletionInput) {
  const split = splitSystemAndConversationMessages(input.messages);
  const contents = split.conversation.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
  return {
    contents,
    systemInstruction:
      split.systemContent.length > 0
        ? { parts: [{ text: split.systemContent }] }
        : undefined,
    generationConfig:
      input.maxOutputTokens !== undefined
        ? { maxOutputTokens: input.maxOutputTokens }
        : undefined,
  };
}

function mapGeminiBatchResultRow(
  row: unknown,
): BatchInferenceProviderItemResult {
  const record = row as {
    request_id?: string;
    response?: {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: unknown;
    };
    error?: { message?: string; code?: number };
  };
  const providerCorrelationId = record.request_id ?? "unknown";
  if (record.error) {
    return {
      providerCorrelationId,
      error: {
        code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        message: record.error.message ?? "gemini batch item failed",
        providerErrorCode: String(record.error.code ?? ""),
      },
    };
  }
  const parts =
    record.response?.candidates?.[0]?.content?.parts?.map(
      (p) => p.text ?? "",
    ) ?? [];
  const text = parts.join("");
  const normalized = record.response?.usageMetadata
    ? normalizeGeminiGenerateContentUsage(record.response.usageMetadata)
    : undefined;
  const usage = normalized ? toModelStreamUsage(normalized) : undefined;
  return {
    providerCorrelationId,
    result: {
      text: text.length > 0 ? text : undefined,
      toolCalls: [],
      finishReason: "stop",
      usage,
    },
    usage,
  };
}
