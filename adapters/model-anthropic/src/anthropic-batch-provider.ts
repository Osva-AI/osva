import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import {
  type BatchInferenceProviderAdapter,
  type BatchInferenceProviderItemResult,
  type BatchInferenceProviderResultsPage,
  type BatchInferenceProviderSubmitRequest,
  type BatchInferenceProviderSubmitResult,
  type BatchInferenceProviderStatusResult,
  mapAnthropicBatchStatus,
  toModelStreamUsage,
} from "@osva/model-gateway";
import Anthropic from "@anthropic-ai/sdk";

import { buildAnthropicMessagesCreateBody } from "./anthropic-messages-create-body.js";
import { normalizeAnthropicMessagesUsage } from "./anthropic-usage.js";
import { ANTHROPIC_MESSAGES_API_VERSION } from "./anthropic-provider-adapter.js";

export interface AnthropicBatchProviderOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly fetch?: typeof fetch;
  readonly timeout?: number;
}

export class AnthropicBatchProvider implements BatchInferenceProviderAdapter {
  readonly provider = "ANTHROPIC" as const;
  private readonly client: Anthropic;

  constructor(options: AnthropicBatchProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      fetch: options.fetch,
      maxRetries: 0,
      timeout: options.timeout,
      defaultHeaders: {
        "anthropic-version": ANTHROPIC_MESSAGES_API_VERSION,
      },
    });
  }

  checkCapabilities(): { supported: boolean; reasons: readonly string[] } {
    return { supported: true, reasons: [] };
  }

  async submit(
    request: BatchInferenceProviderSubmitRequest,
  ): Promise<BatchInferenceProviderSubmitResult> {
    const batch = await this.client.messages.batches.create({
      requests: request.items.map((item) => ({
        custom_id: item.providerCorrelationId,
        params: buildAnthropicMessagesCreateBody({
          model: request.providerModelId,
          messages: item.input.messages,
          maxOutputTokens: item.input.maxOutputTokens,
          toolDefinitions: item.input.toolDefinitions,
          jsonSchema: item.input.jsonSchema,
        }),
      })),
    });

    return {
      providerBatchId: batch.id,
      providerJobStatus: mapAnthropicBatchStatus(batch.processing_status),
    };
  }

  async getStatus(
    providerBatchId: string,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderStatusResult> {
    const batch = await this.client.messages.batches.retrieve(providerBatchId, {
      signal: options?.abortSignal,
    });
    return {
      providerBatchId: batch.id,
      providerJobStatus: mapAnthropicBatchStatus(batch.processing_status),
      requestCounts: batch.request_counts
        ? {
            total: batch.request_counts.processing,
            completed: batch.request_counts.succeeded,
            failed: batch.request_counts.errored,
          }
        : undefined,
    };
  }

  async requestCancellation(
    providerBatchId: string,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderStatusResult> {
    const batch = await this.client.messages.batches.cancel(providerBatchId, {
      signal: options?.abortSignal,
    });
    return {
      providerBatchId: batch.id,
      providerJobStatus: mapAnthropicBatchStatus(batch.processing_status),
    };
  }

  async fetchResults(
    providerBatchId: string,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderResultsPage> {
    const items: BatchInferenceProviderItemResult[] = [];
    const stream = await this.client.messages.batches.results(providerBatchId, {
      signal: options?.abortSignal,
    });
    for await (const entry of stream) {
      items.push(mapAnthropicBatchResultEntry(entry));
    }
    return { items, done: true };
  }
}

function mapAnthropicBatchResultEntry(
  entry: Anthropic.Messages.Batches.MessageBatchIndividualResponse,
): BatchInferenceProviderItemResult {
  const providerCorrelationId = entry.custom_id;
  if (entry.result.type === "errored") {
    return {
      providerCorrelationId,
      error: {
        code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        message:
          entry.result.error.error?.message ?? "anthropic batch item errored",
        providerErrorCode: entry.result.error.error?.type,
      },
    };
  }
  if (entry.result.type === "canceled") {
    return {
      providerCorrelationId,
      error: {
        code: MODEL_ERROR_CODES.MODEL_CANCELLED,
        message: "anthropic batch item canceled",
      },
    };
  }
  if (entry.result.type !== "succeeded") {
    return {
      providerCorrelationId,
      error: {
        code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        message: `anthropic batch item ${entry.result.type}`,
      },
    };
  }
  const message = entry.result.message;
  const text = message.content
    .map((block: { type: string; text?: string }) =>
      block.type === "text" ? (block.text ?? "") : "",
    )
    .join("");
  const normalized = normalizeAnthropicMessagesUsage(message.usage);
  const usage = normalized ? toModelStreamUsage(normalized) : undefined;
  return {
    providerCorrelationId,
    result: {
      text: text.length > 0 ? text : undefined,
      toolCalls: [],
      finishReason: message.stop_reason === "end_turn" ? "stop" : "other",
      usage,
    },
    usage,
  };
}
