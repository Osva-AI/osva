import type { ModelFinishReason, ModelToolCall } from "@osva-ai/contracts";

/**
 * Provider-normalized token usage for internal gateway outcomes.
 *
 * When the parent result omits `usage`, token accounting is **unknown** (not zero).
 * When present, `inputTokens` is the provider's total input/prompt count. If
 * `cachedInputTokens` is set, it is a **subset** of input tokens (not additive).
 * `totalTokens` is the provider-reported total (typically input + output).
 */
export interface NormalizedModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
  /**
   * Provider-reported cache **write** input tokens (e.g. Anthropic
   * `cache_creation_input_tokens`). Subset of {@link inputTokens}, not additive.
   */
  readonly cacheWriteInputTokens?: number;
  /**
   * True when the provider returned a usage object but omitted one or more token
   * fields OSVA expects for complete accounting.
   */
  readonly incomplete?: boolean;
}

/**
 * Distinguishes the configured provider model id from the model id reported on
 * the provider response (when available).
 */
export interface ProviderGenerateTextInvocation {
  readonly configuredProviderModelId: string;
  readonly providerReportedModelId?: string;
}

export interface ProviderGenerateTextResult {
  readonly text?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly usage?: NormalizedModelUsage;
  readonly finishReason?: ModelFinishReason;
  readonly providerRequestId?: string;
  readonly providerFinishReason?: string;
  readonly invocation?: ProviderGenerateTextInvocation;
}
