import type { ModelProfileVersionPricing } from "@osva/contracts";

export interface ModelTokenUsageForCost {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Deterministic estimated model cost from immutable pricing and token usage.
 *
 * Uses integer arithmetic with BigInt intermediates. Each token-rate product
 * is rounded half-up to the nearest micro-USD before summing contributions.
 * Returns null when pricing is unavailable.
 */
export function estimateModelCostUsdMicros(
  usage: ModelTokenUsageForCost,
  pricing: ModelProfileVersionPricing | undefined,
): number | null {
  if (pricing === undefined) {
    return null;
  }

  const inputContribution = microUsdContribution(
    usage.inputTokens,
    pricing.inputUsdMicrosPerMillionTokens,
  );
  const outputContribution = microUsdContribution(
    usage.outputTokens,
    pricing.outputUsdMicrosPerMillionTokens,
  );

  return inputContribution + outputContribution;
}

function microUsdContribution(
  tokens: number,
  usdMicrosPerMillionTokens: number,
): number {
  const numerator =
    BigInt(tokens) * BigInt(usdMicrosPerMillionTokens) + 500_000n;
  return Number(numerator / 1_000_000n);
}
