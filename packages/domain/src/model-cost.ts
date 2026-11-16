import type { ModelProfileVersionPricing } from "@osva-ai/contracts";

export interface ModelTokenUsageForCost {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
}

export interface ModelCostEstimateOptions {
  readonly configuredProviderModelId: string | undefined;
  readonly providerReportedModelId: string | undefined;
  readonly usageIncomplete?: boolean;
}

/**
 * Deterministic estimated model cost from immutable pricing and token usage.
 *
 * Uses integer arithmetic with BigInt intermediates. Each token-rate product is
 * rounded half-up to the nearest micro-USD before summing contributions.
 * Returns null when pricing is unavailable, usage is incomplete, required cache
 * rates are missing for positive cache categories, or provider-reported model
 * identity is not eligible for the configured ModelProfileVersion pricing.
 */
export function estimateModelCostUsdMicros(
  usage: ModelTokenUsageForCost,
  pricing: ModelProfileVersionPricing | undefined,
  options?: ModelCostEstimateOptions,
): number | null {
  if (pricing === undefined) {
    return null;
  }

  if (options?.usageIncomplete === true) {
    return null;
  }

  if (
    !isModelPricingEligible(
      options?.configuredProviderModelId,
      options?.providerReportedModelId,
    )
  ) {
    return null;
  }

  const cachedRead = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheWriteInputTokens ?? 0;

  if (
    cachedRead > 0 &&
    pricing.cachedReadInputUsdMicrosPerMillionTokens === undefined
  ) {
    return null;
  }

  if (
    cacheWrite > 0 &&
    pricing.cachedWriteInputUsdMicrosPerMillionTokens === undefined
  ) {
    return null;
  }

  const uncachedInput = usage.inputTokens - cachedRead - cacheWrite;
  if (uncachedInput < 0) {
    return null;
  }

  const uncachedContribution = microUsdContribution(
    uncachedInput,
    pricing.inputUsdMicrosPerMillionTokens,
  );
  const cachedReadContribution =
    cachedRead > 0
      ? microUsdContribution(
          cachedRead,
          pricing.cachedReadInputUsdMicrosPerMillionTokens!,
        )
      : 0;
  const cacheWriteContribution =
    cacheWrite > 0
      ? microUsdContribution(
          cacheWrite,
          pricing.cachedWriteInputUsdMicrosPerMillionTokens!,
        )
      : 0;
  const outputContribution = microUsdContribution(
    usage.outputTokens,
    pricing.outputUsdMicrosPerMillionTokens,
  );

  return (
    uncachedContribution +
    cachedReadContribution +
    cacheWriteContribution +
    outputContribution
  );
}

/**
 * Conservative rule: configured ModelProfileVersion pricing applies only when
 * provider-reported model identity is absent or plausibly the same configured
 * model (exact match or provider-reported version suffix when the
 * configured id contains a hyphen segment, e.g. gpt-4o-2024-08-06).
 */
export function isModelPricingEligible(
  configuredProviderModelId: string | undefined,
  providerReportedModelId: string | undefined,
): boolean {
  if (providerReportedModelId === undefined) {
    return true;
  }

  if (configuredProviderModelId === undefined) {
    return false;
  }

  if (providerReportedModelId === configuredProviderModelId) {
    return true;
  }

  if (
    configuredProviderModelId.includes("-") &&
    providerReportedModelId.startsWith(`${configuredProviderModelId}-`)
  ) {
    return true;
  }

  return false;
}

function microUsdContribution(
  tokens: number,
  usdMicrosPerMillionTokens: number,
): number {
  const numerator =
    BigInt(tokens) * BigInt(usdMicrosPerMillionTokens) + 500_000n;
  return Number(numerator / 1_000_000n);
}
