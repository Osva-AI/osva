import { type ModelFinishReason } from "@osva-ai/contracts";
import {
  buildProviderInvocationMetadata,
  sanitizeProviderModelId,
  type NormalizedModelUsage,
} from "@osva/model-gateway";
import type { ResponseUsage } from "openai/resources/responses/responses";
import type OpenAI from "openai";

export { buildProviderInvocationMetadata, sanitizeProviderModelId };

export function normalizeOpenAiResponsesUsage(
  usage: ResponseUsage | undefined,
): NormalizedModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const incomplete =
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0;

  if (incomplete) {
    return {
      inputTokens: Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0,
      outputTokens: Number.isFinite(outputTokens)
        ? Math.max(0, outputTokens)
        : 0,
      totalTokens: Number.isFinite(usage.total_tokens)
        ? Math.max(0, usage.total_tokens)
        : 0,
      incomplete: true,
    };
  }

  const cachedRaw = usage.input_tokens_details?.cached_tokens;
  const cachedInputTokens =
    cachedRaw !== undefined && cachedRaw > 0 ? cachedRaw : undefined;
  const providerTotal = usage.total_tokens;
  const totalTokens =
    Number.isFinite(providerTotal) && providerTotal >= 0
      ? providerTotal
      : inputTokens + outputTokens;

  const usageIncomplete =
    !Number.isFinite(usage.total_tokens) &&
    usage.input_tokens_details === undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    ...(usageIncomplete ? { incomplete: true } : {}),
  };
}

export function normalizeOpenAiChatCompletionUsage(
  usage: OpenAI.Completions.CompletionUsage | undefined,
): NormalizedModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;

  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0
  ) {
    return {
      inputTokens:
        inputTokens !== undefined && Number.isFinite(inputTokens)
          ? Math.max(0, inputTokens)
          : 0,
      outputTokens:
        outputTokens !== undefined && Number.isFinite(outputTokens)
          ? Math.max(0, outputTokens)
          : 0,
      totalTokens:
        usage.total_tokens !== undefined && Number.isFinite(usage.total_tokens)
          ? Math.max(0, usage.total_tokens)
          : 0,
      incomplete: true,
    };
  }

  const cachedRaw = usage.prompt_tokens_details?.cached_tokens;
  const cachedInputTokens =
    cachedRaw !== undefined && cachedRaw > 0 ? cachedRaw : undefined;

  const providerTotal = usage.total_tokens;
  const totalTokens =
    providerTotal !== undefined &&
    Number.isFinite(providerTotal) &&
    providerTotal >= 0
      ? providerTotal
      : inputTokens + outputTokens;

  const usageIncomplete =
    usage.total_tokens === undefined &&
    usage.prompt_tokens_details === undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    ...(usageIncomplete ? { incomplete: true } : {}),
  };
}

export function mapOpenAiChatFinishReason(input: {
  readonly toolCallCount: number;
  readonly choiceFinishReason: string | null | undefined;
}): {
  readonly finishReason: ModelFinishReason;
  readonly providerFinishReason: string | undefined;
} {
  if (input.toolCallCount > 0) {
    return { finishReason: "tool_call", providerFinishReason: "tool_calls" };
  }

  if (input.choiceFinishReason === "length") {
    return { finishReason: "length", providerFinishReason: "length" };
  }

  return {
    finishReason: "stop",
    providerFinishReason: input.choiceFinishReason ?? undefined,
  };
}
