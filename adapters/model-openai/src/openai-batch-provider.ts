import type {
  GenerateCompletionInput,
  ModelConversationMessage,
} from "@osva-ai/contracts";
import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import {
  type BatchInferenceProviderAdapter,
  type BatchInferenceProviderItemResult,
  type BatchInferenceProviderResultsPage,
  type BatchInferenceProviderSubmitRequest,
  type BatchInferenceProviderSubmitResult,
  type BatchInferenceProviderStatusResult,
  mapOpenAiBatchStatus,
} from "@osva/model-gateway";
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { toModelStreamUsage } from "@osva/model-gateway";

import {
  mapOpenAiChatFinishReason,
  normalizeOpenAiChatCompletionUsage,
} from "./openai-usage.js";

export const OPENAI_BATCH_ENDPOINT = "/v1/chat/completions" as const;

export interface OpenAIBatchProviderOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly fetch?: typeof fetch;
  readonly timeout?: number;
}

export class OpenAIBatchProvider implements BatchInferenceProviderAdapter {
  readonly provider = "OPENAI" as const;
  private readonly client: OpenAI;

  constructor(options: OpenAIBatchProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      fetch: options.fetch,
      maxRetries: 0,
      timeout: options.timeout,
    });
  }

  checkCapabilities(): { supported: boolean; reasons: readonly string[] } {
    return { supported: true, reasons: [] };
  }

  async submit(
    request: BatchInferenceProviderSubmitRequest,
  ): Promise<BatchInferenceProviderSubmitResult> {
    const jsonl = request.items
      .map((item) =>
        JSON.stringify({
          custom_id: item.providerCorrelationId,
          method: "POST",
          url: OPENAI_BATCH_ENDPOINT,
          body: toOpenAiChatBody(request.providerModelId, item.input),
        }),
      )
      .join("\n");

    const file = await this.client.files.create({
      file: new File([jsonl], "batch-input.jsonl", {
        type: "application/jsonl",
      }),
      purpose: "batch",
    });

    const batch = await this.client.batches.create({
      input_file_id: file.id,
      endpoint: OPENAI_BATCH_ENDPOINT,
      completion_window: "24h",
    });

    return {
      providerBatchId: batch.id,
      providerJobStatus: mapOpenAiBatchStatus(batch.status),
    };
  }

  async getStatus(
    providerBatchId: string,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderStatusResult> {
    const batch = await this.client.batches.retrieve(providerBatchId, {
      signal: options?.abortSignal,
    });
    return {
      providerBatchId: batch.id,
      providerJobStatus: mapOpenAiBatchStatus(batch.status),
      requestCounts: batch.request_counts
        ? {
            total: batch.request_counts.total,
            completed: batch.request_counts.completed,
            failed: batch.request_counts.failed,
          }
        : undefined,
      outputFileId: batch.output_file_id ?? undefined,
      errorFileId: batch.error_file_id ?? undefined,
    };
  }

  async requestCancellation(
    providerBatchId: string,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderStatusResult> {
    const batch = await this.client.batches.cancel(providerBatchId, {
      signal: options?.abortSignal,
    });
    return {
      providerBatchId: batch.id,
      providerJobStatus: mapOpenAiBatchStatus(batch.status),
      outputFileId: batch.output_file_id ?? undefined,
      errorFileId: batch.error_file_id ?? undefined,
    };
  }

  async fetchResults(
    providerBatchId: string,
    options?: {
      readonly abortSignal?: AbortSignal;
      readonly outputFileId?: string;
      readonly errorFileId?: string;
    },
  ): Promise<BatchInferenceProviderResultsPage> {
    const status =
      options?.outputFileId !== undefined
        ? {
            outputFileId: options.outputFileId,
            errorFileId: options.errorFileId,
          }
        : await this.getStatus(providerBatchId, options);

    const items: BatchInferenceProviderItemResult[] = [];

    if (status.outputFileId) {
      const content = await this.client.files.content(status.outputFileId, {
        signal: options?.abortSignal,
      });
      const text = await content.text();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        items.push(parseOpenAiBatchOutputLine(trimmed));
      }
    }

    if (status.errorFileId) {
      const content = await this.client.files.content(status.errorFileId, {
        signal: options?.abortSignal,
      });
      const text = await content.text();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        items.push(parseOpenAiBatchErrorLine(trimmed));
      }
    }

    return { items, done: true };
  }
}

function toOpenAiChatBody(
  model: string,
  input: GenerateCompletionInput,
): ChatCompletionCreateParamsNonStreaming {
  return {
    model,
    messages: toOpenAiMessages(input.messages),
    max_tokens: input.maxOutputTokens,
  };
}

function toOpenAiMessages(
  messages: readonly ModelConversationMessage[],
): ChatCompletionCreateParamsNonStreaming["messages"] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    return { role: message.role, content: message.content };
  });
}

function parseOpenAiBatchOutputLine(
  line: string,
): BatchInferenceProviderItemResult {
  const row = JSON.parse(line) as {
    custom_id?: string;
    response?: {
      body?: {
        choices?: Array<{
          message?: { content?: string | null };
          finish_reason?: string;
        }>;
        usage?: unknown;
      };
      status_code?: number;
    };
    error?: { message?: string; code?: string };
  };

  const providerCorrelationId = row.custom_id ?? "unknown";

  if (row.error) {
    return {
      providerCorrelationId,
      error: {
        code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        message: row.error.message ?? "provider batch item failed",
        providerErrorCode: row.error.code,
      },
    };
  }

  const choice = row.response?.body?.choices?.[0];
  const mappedFinish = mapOpenAiChatFinishReason({
    choiceFinishReason: choice?.finish_reason ?? "stop",
    toolCallCount: 0,
  });
  const normalized = row.response?.body?.usage
    ? normalizeOpenAiChatCompletionUsage(
        row.response.body.usage as {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        },
      )
    : undefined;
  const usage = normalized ? toModelStreamUsage(normalized) : undefined;

  return {
    providerCorrelationId,
    result: {
      text: choice?.message?.content ?? undefined,
      toolCalls: [],
      finishReason: mappedFinish.finishReason,
      usage,
    },
    usage,
  };
}

function parseOpenAiBatchErrorLine(
  line: string,
): BatchInferenceProviderItemResult {
  const row = JSON.parse(line) as {
    custom_id?: string;
    error?: { message?: string; code?: string };
  };
  return {
    providerCorrelationId: row.custom_id ?? "unknown",
    error: {
      code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      message: row.error?.message ?? "batch item error",
      providerErrorCode: row.error?.code,
    },
  };
}
