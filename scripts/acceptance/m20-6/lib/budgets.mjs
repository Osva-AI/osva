/**
 * @typedef {Object} M20_6BudgetConfig
 * @property {number} maxBuilderRequests
 * @property {number} maxProviderInvocations
 * @property {number} maxOutputTokensPerAttempt
 * @property {number} maxTotalDurationMs
 * @property {number} [maxEstimatedCostUsdMicros]
 */

/** @returns {M20_6BudgetConfig} */
export function loadBudgetFromEnv(env = process.env) {
  const smoke = env.OSVA_M20_6_SMOKE === "1" || env.OSVA_M20_6_SMOKE === "true";
  return {
    maxBuilderRequests: intEnv(
      env.OSVA_M20_6_MAX_BUILDER_REQUESTS,
      smoke ? 4 : 48,
    ),
    maxProviderInvocations: intEnv(
      env.OSVA_M20_6_MAX_PROVIDER_INVOCATIONS,
      smoke ? 8 : 96,
    ),
    maxOutputTokensPerAttempt: intEnv(env.OSVA_M20_6_MAX_OUTPUT_TOKENS, 4096),
    maxTotalDurationMs: intEnv(
      env.OSVA_M20_6_MAX_TOTAL_DURATION_MS,
      smoke ? 300_000 : 900_000,
    ),
    maxEstimatedCostUsdMicros: env.OSVA_M20_6_MAX_COST_USD_MICROS
      ? Number(env.OSVA_M20_6_MAX_COST_USD_MICROS)
      : undefined,
  };
}

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 */
function intEnv(raw, fallback) {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * @param {{ builderRequests: number, providerInvocations: number, elapsedMs: number, estimatedCostUsdMicros?: number }} usage
 * @param {M20_6BudgetConfig} budget
 */
export function budgetExceeded(usage, budget) {
  if (usage.builderRequests > budget.maxBuilderRequests) {
    return "MAX_BUILDER_REQUESTS";
  }
  if (usage.providerInvocations > budget.maxProviderInvocations) {
    return "MAX_PROVIDER_INVOCATIONS";
  }
  if (usage.elapsedMs > budget.maxTotalDurationMs) {
    return "MAX_TOTAL_DURATION";
  }
  if (
    budget.maxEstimatedCostUsdMicros !== undefined &&
    usage.estimatedCostUsdMicros !== undefined &&
    usage.estimatedCostUsdMicros > budget.maxEstimatedCostUsdMicros
  ) {
    return "MAX_ESTIMATED_COST";
  }
  return undefined;
}
