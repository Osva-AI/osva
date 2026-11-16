import type { NormalizedModelUsage } from "@osva/model-gateway";

export interface GeminiUsageMetadataShape {
  readonly promptTokenCount?: number;
  readonly cachedContentTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly thoughtsTokenCount?: number;
  readonly toolUsePromptTokenCount?: number;
  readonly totalTokenCount?: number;
}

function nonNegativeInt(value: number | undefined): {
  readonly present: boolean;
  readonly value: number;
} {
  if (value === undefined || !Number.isFinite(value)) {
    return { present: false, value: 0 };
  }

  const rounded = Math.trunc(value);
  if (rounded < 0) {
    return { present: true, value: 0 };
  }

  return { present: true, value: rounded };
}

/**
 * Gemini `generateContent` usage normalization.
 *
 * `promptTokenCount` already includes cached prompt content; do not add
 * `cachedContentTokenCount` again. Output includes candidate and thinking tokens.
 * `toolUsePromptTokenCount` is informational breakdown only (included in
 * `promptTokenCount` when the provider reports both).
 */
export function normalizeGeminiGenerateContentUsage(
  usage: GeminiUsageMetadataShape | undefined,
): NormalizedModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const prompt = nonNegativeInt(usage.promptTokenCount);
  const cached = nonNegativeInt(usage.cachedContentTokenCount);
  const candidates = nonNegativeInt(usage.candidatesTokenCount);
  const thoughts = nonNegativeInt(usage.thoughtsTokenCount);
  const providerTotal = nonNegativeInt(usage.totalTokenCount);

  if (!prompt.present) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: providerTotal.present ? providerTotal.value : 0,
      incomplete: true,
    };
  }

  const inputTokens = prompt.value;
  const outputTokens = candidates.value + thoughts.value;

  const cachedInputTokens =
    cached.present && cached.value > 0 ? cached.value : undefined;

  const summedTotal = inputTokens + outputTokens;
  let totalTokens = summedTotal;
  let incomplete = false;

  if (providerTotal.present) {
    totalTokens = providerTotal.value;
    if (providerTotal.value < summedTotal) {
      incomplete = true;
    }
  } else if (
    usage.candidatesTokenCount === undefined &&
    usage.thoughtsTokenCount === undefined
  ) {
    incomplete = true;
  }

  if (cached.present && cached.value > 0 && cached.value > inputTokens) {
    incomplete = true;
  }

  const hasPartialOutput =
    usage.candidatesTokenCount === undefined &&
    usage.thoughtsTokenCount !== undefined;

  if (hasPartialOutput) {
    incomplete = true;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(incomplete ? { incomplete } : {}),
  };
}
