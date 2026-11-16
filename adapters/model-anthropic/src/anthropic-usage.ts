import type { NormalizedModelUsage } from "@osva/model-gateway";
import type { Usage } from "@anthropic-ai/sdk/resources/messages/messages";

function nonNegativeInt(value: number | null | undefined): {
  readonly present: boolean;
  readonly value: number;
} {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { present: false, value: 0 };
  }

  const rounded = Math.trunc(value);
  if (rounded < 0) {
    return { present: true, value: 0 };
  }

  return { present: true, value: rounded };
}

/**
 * Anthropic Messages API usage normalization.
 *
 * Total input is the sum of uncached `input_tokens`, `cache_creation_input_tokens`,
 * and `cache_read_input_tokens`. Cache reads and writes are subsets of that total,
 * not additive to it.
 */
export function normalizeAnthropicMessagesUsage(
  usage: Usage | undefined,
): NormalizedModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const uncached = nonNegativeInt(usage.input_tokens);
  const cacheRead = nonNegativeInt(usage.cache_read_input_tokens);
  const cacheWrite = nonNegativeInt(usage.cache_creation_input_tokens);
  const output = nonNegativeInt(usage.output_tokens);

  if (!uncached.present || !output.present) {
    return {
      inputTokens:
        (uncached.present ? uncached.value : 0) +
        (cacheRead.present ? cacheRead.value : 0) +
        (cacheWrite.present ? cacheWrite.value : 0),
      outputTokens: output.present ? output.value : 0,
      totalTokens: 0,
      ...(cacheRead.present && cacheRead.value > 0
        ? { cachedInputTokens: cacheRead.value }
        : {}),
      ...(cacheWrite.present && cacheWrite.value > 0
        ? { cacheWriteInputTokens: cacheWrite.value }
        : {}),
      incomplete: true,
    };
  }

  const inputTokens = uncached.value + cacheRead.value + cacheWrite.value;
  const outputTokens = output.value;
  const totalTokens = inputTokens + outputTokens;

  const cachedInputTokens =
    cacheRead.present && cacheRead.value > 0 ? cacheRead.value : undefined;
  const cacheWriteInputTokens =
    cacheWrite.present && cacheWrite.value > 0 ? cacheWrite.value : undefined;

  const usageIncomplete =
    (usage.cache_read_input_tokens !== undefined &&
      usage.cache_read_input_tokens !== null &&
      !cacheRead.present) ||
    (usage.cache_creation_input_tokens !== undefined &&
      usage.cache_creation_input_tokens !== null &&
      !cacheWrite.present);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
    ...(usageIncomplete ? { incomplete: true } : {}),
  };
}
