/**
 * Conservative per-1M-token USD pricing for live budget preflight (micro-USD).
 * Unknown models require explicit operator pricing or block when cost cap is set.
 */

export const MODEL_PRICING_VERSION = "m20-7.1-2026-11-08";
export const MODEL_PRICING_RATE_SOURCE =
  "operator-declared-conservative-defaults";

/**
 * @typedef {Object} ModelPricingRow
 * @property {number} inputUsdPer1M Micro-USD per 1M input tokens (1 USD = 1_000_000 micros)
 * @property {number} outputUsdPer1M Micro-USD per 1M output tokens
 */

/** @type {Readonly<Record<string, ModelPricingRow>>} */
export const DECLARED_MODEL_PRICING = Object.freeze({
  "gpt-4o-mini": { inputUsdPer1M: 150_000, outputUsdPer1M: 600_000 },
  "gpt-4o": { inputUsdPer1M: 2_500_000, outputUsdPer1M: 10_000_000 },
  "gemini-2.0-flash": { inputUsdPer1M: 100_000, outputUsdPer1M: 400_000 },
  "gemini-2.5-flash": { inputUsdPer1M: 150_000, outputUsdPer1M: 600_000 },
});

/**
 * @param {string} modelId
 * @returns {ModelPricingRow | undefined}
 */
export function lookupModelPricing(modelId) {
  const key = modelId.trim();
  return DECLARED_MODEL_PRICING[key];
}

/**
 * Worst-case micro-USD for one attempt given token ceilings.
 *
 * @param {string} modelId
 * @param {{ maxInputTokens: number, maxOutputTokens: number }} bounds
 * @returns {{ estimatedMicroUsd: number | undefined, reason?: string }}
 */
export function worstCaseAttemptCostMicroUsd(modelId, bounds) {
  const row = lookupModelPricing(modelId);
  if (row === undefined) {
    return { estimatedMicroUsd: undefined, reason: "UNKNOWN_MODEL_PRICING" };
  }
  const inputMicro = (bounds.maxInputTokens / 1_000_000) * row.inputUsdPer1M;
  const outputMicro = (bounds.maxOutputTokens / 1_000_000) * row.outputUsdPer1M;
  return {
    estimatedMicroUsd: Math.ceil(inputMicro + outputMicro),
  };
}
