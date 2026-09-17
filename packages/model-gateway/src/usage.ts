import type { ModelFinishReason } from "./finish-reason.js";

export interface NormalizedModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
}

export interface ProviderGenerateTextResult {
  readonly text: string;
  readonly usage?: NormalizedModelUsage;
  readonly finishReason?: ModelFinishReason;
  readonly providerRequestId?: string;
  readonly providerFinishReason?: string;
}
