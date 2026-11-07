import { worstCaseAttemptCostMicroUsd } from "./pricing.mjs";

/**
 * @typedef {Object} M20_7BudgetConfig
 * @property {number} maxBuilderRequests
 * @property {number} maxProviderInvocations
 * @property {number} maxOutputTokensPerAttempt
 * @property {number} maxInputTokensPerAttempt
 * @property {number} maxTotalDurationMs
 * @property {number} maxConsecutiveFailures
 * @property {number} maxRepairAttempts
 * @property {number | undefined} maxEstimatedCostUsdMicros
 * @property {boolean} costCapRequired
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ live: boolean, smoke: boolean }} mode
 * @returns {{ config: M20_7BudgetConfig, errors: string[] }}
 */
export function loadAndValidateBudgetFromEnv(env, mode) {
  const smoke = mode.smoke;
  const live = mode.live;
  const errors = [];

  /** @type {M20_7BudgetConfig} */
  const config = {
    maxBuilderRequests: intEnv(
      env.OSVA_M20_7_MAX_BUILDER_REQUESTS,
      live ? (smoke ? 2 : 6) : smoke ? 4 : 48,
    ),
    maxProviderInvocations: intEnv(
      env.OSVA_M20_7_MAX_PROVIDER_INVOCATIONS,
      live ? (smoke ? 4 : 12) : smoke ? 8 : 96,
    ),
    maxOutputTokensPerAttempt: intEnv(
      env.OSVA_M20_7_MAX_OUTPUT_TOKENS,
      live ? 2048 : 4096,
    ),
    maxInputTokensPerAttempt: intEnv(
      env.OSVA_M20_7_MAX_INPUT_TOKENS,
      live ? 8192 : 32_768,
    ),
    maxTotalDurationMs: intEnv(
      env.OSVA_M20_7_MAX_TOTAL_DURATION_MS,
      live ? (smoke ? 180_000 : 600_000) : smoke ? 300_000 : 900_000,
    ),
    maxConsecutiveFailures: intEnv(
      env.OSVA_M20_7_MAX_CONSECUTIVE_FAILURES,
      live ? 2 : 8,
    ),
    maxRepairAttempts: intEnv(env.OSVA_M20_7_MAX_REPAIR_ATTEMPTS, live ? 2 : 6),
    maxEstimatedCostUsdMicros: env.OSVA_M20_7_MAX_COST_USD_MICROS
      ? Number(env.OSVA_M20_7_MAX_COST_USD_MICROS)
      : undefined,
    costCapRequired: live,
  };

  if (live && config.maxEstimatedCostUsdMicros === undefined) {
    errors.push("OSVA_M20_7_MAX_COST_USD_MICROS required in live mode");
  }
  if (
    live &&
    config.maxEstimatedCostUsdMicros !== undefined &&
    (!Number.isFinite(config.maxEstimatedCostUsdMicros) ||
      config.maxEstimatedCostUsdMicros <= 0)
  ) {
    errors.push("OSVA_M20_7_MAX_COST_USD_MICROS must be a positive number");
  }

  return { config, errors };
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
 * @typedef {Object} BudgetUsageState
 * @property {number} builderRequests
 * @property {number} providerInvocations
 * @property {number} repairAttempts
 * @property {number} consecutiveFailures
 * @property {number} elapsedMs
 * @property {number} estimatedCostUsdMicros
 * @property {number} reservedCostUsdMicros
 * @property {boolean} usageMissingTreatedAsUnknown
 */

export function createBudgetUsageState() {
  return /** @type {BudgetUsageState} */ ({
    builderRequests: 0,
    providerInvocations: 0,
    repairAttempts: 0,
    consecutiveFailures: 0,
    elapsedMs: 0,
    estimatedCostUsdMicros: 0,
    reservedCostUsdMicros: 0,
    usageMissingTreatedAsUnknown: false,
  });
}

/**
 * @param {BudgetUsageState} usage
 * @param {M20_7BudgetConfig} budget
 * @returns {string | undefined}
 */
export function budgetExceeded(usage, budget) {
  if (usage.builderRequests >= budget.maxBuilderRequests) {
    return "MAX_BUILDER_REQUESTS";
  }
  if (usage.providerInvocations >= budget.maxProviderInvocations) {
    return "MAX_PROVIDER_INVOCATIONS";
  }
  if (usage.repairAttempts >= budget.maxRepairAttempts) {
    return "MAX_REPAIR_ATTEMPTS";
  }
  if (usage.consecutiveFailures >= budget.maxConsecutiveFailures) {
    return "MAX_CONSECUTIVE_FAILURES";
  }
  if (usage.elapsedMs > budget.maxTotalDurationMs) {
    return "MAX_TOTAL_DURATION";
  }
  const committed = usage.estimatedCostUsdMicros + usage.reservedCostUsdMicros;
  if (
    budget.maxEstimatedCostUsdMicros !== undefined &&
    committed > budget.maxEstimatedCostUsdMicros
  ) {
    return "MAX_ESTIMATED_COST";
  }
  if (usage.usageMissingTreatedAsUnknown && budget.costCapRequired) {
    return "UNKNOWN_USAGE_UNDER_COST_CAP";
  }
  return undefined;
}

/**
 * Reserve worst-case cost before a provider call. Rejects when cap would be exceeded.
 *
 * @param {BudgetUsageState} usage
 * @param {M20_7BudgetConfig} budget
 * @param {{ modelId: string, kind: "builder" | "provider" | "repair" }} attempt
 */
export function reserveBeforeProviderRequest(usage, budget, attempt) {
  if (attempt.kind === "builder") {
    if (usage.builderRequests + 1 > budget.maxBuilderRequests) {
      return "MAX_BUILDER_REQUESTS";
    }
  }
  if (usage.providerInvocations + 1 > budget.maxProviderInvocations) {
    return "MAX_PROVIDER_INVOCATIONS";
  }
  if (attempt.kind === "repair") {
    if (usage.repairAttempts + 1 > budget.maxRepairAttempts) {
      return "MAX_REPAIR_ATTEMPTS";
    }
  }

  const worst = worstCaseAttemptCostMicroUsd(attempt.modelId, {
    maxInputTokens: budget.maxInputTokensPerAttempt,
    maxOutputTokens: budget.maxOutputTokensPerAttempt,
  });

  if (budget.maxEstimatedCostUsdMicros !== undefined) {
    if (worst.estimatedMicroUsd === undefined) {
      return worst.reason ?? "UNKNOWN_MODEL_PRICING";
    }
    const nextCommitted =
      usage.estimatedCostUsdMicros +
      usage.reservedCostUsdMicros +
      worst.estimatedMicroUsd;
    if (nextCommitted > budget.maxEstimatedCostUsdMicros) {
      return "MAX_ESTIMATED_COST";
    }
    usage.reservedCostUsdMicros += worst.estimatedMicroUsd;
  }

  if (attempt.kind === "builder") {
    usage.builderRequests += 1;
  }
  if (attempt.kind === "repair") {
    usage.repairAttempts += 1;
  }
  usage.providerInvocations += 1;
  return undefined;
}

/**
 * @param {BudgetUsageState} usage
 * @param {{ inputUnits?: number, outputUnits?: number, modelId: string, success: boolean }} result
 * @param {M20_7BudgetConfig} budget
 */
export function reconcileAfterProviderRequest(usage, result, budget) {
  const reserved = usage.reservedCostUsdMicros;
  usage.reservedCostUsdMicros = 0;

  if (result.success) {
    usage.consecutiveFailures = 0;
  } else {
    usage.consecutiveFailures += 1;
  }

  if (
    result.inputUnits === undefined &&
    result.outputUnits === undefined &&
    budget.maxEstimatedCostUsdMicros !== undefined
  ) {
    usage.usageMissingTreatedAsUnknown = true;
    // Release reservation but do not assume zero cost
    usage.estimatedCostUsdMicros += reserved;
    return;
  }

  const row = worstCaseAttemptCostMicroUsd(result.modelId, {
    maxInputTokens: result.inputUnits ?? 0,
    maxOutputTokens: result.outputUnits ?? 0,
  });
  if (row.estimatedMicroUsd !== undefined) {
    usage.estimatedCostUsdMicros += row.estimatedMicroUsd;
  } else if (budget.maxEstimatedCostUsdMicros !== undefined) {
    usage.usageMissingTreatedAsUnknown = true;
    usage.estimatedCostUsdMicros += reserved;
  }
}
