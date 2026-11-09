import { loadAndValidateBudgetFromEnv } from "./budgets.mjs";
import {
  evaluateLivePreflight,
  liveExecuteBlockedReason,
} from "./live-guards.mjs";
import { M20_7_DEFAULT_GEMINI_MODEL } from "./gemini-model-lifecycle.mjs";
import { worstCaseAttemptCostMicroUsd } from "./pricing.mjs";

export const M20_7_GEMINI_PROBE_ARTIFACT = "gemini-generation-probe.json";

/**
 * @param {string | undefined} outcome
 * @returns {number}
 */
export function geminiGenerationProbeExecuteExitCode(outcome) {
  if (outcome === "BUILDER_GENERATION_PASS") {
    return 0;
  }
  if (outcome === "PROBE_DRY_RUN" || outcome === "PROBE_BLOCKED") {
    return 0;
  }
  return 1;
}

/** @param {NodeJS.ProcessEnv} base */
export function geminiGenerationProbeBaseEnv(base = process.env) {
  return {
    ...base,
    OSVA_M20_7_LIVE: "1",
    OSVA_M20_7_ISOLATED: "1",
    OSVA_M20_7_LIVE_PROVIDER: "gemini",
    OSVA_M20_7_GENERATION_MODEL:
      base.OSVA_M20_7_GENERATION_MODEL?.trim() ?? M20_7_DEFAULT_GEMINI_MODEL,
    OSVA_M20_7_MAX_BUILDER_REQUESTS: "1",
    OSVA_M20_7_MAX_PROVIDER_INVOCATIONS: "1",
    OSVA_M20_7_MAX_REPAIR_ATTEMPTS: "0",
    OSVA_M20_7_MAX_OUTPUT_TOKENS: "2048",
    OSVA_M20_7_MAX_INPUT_TOKENS: "8192",
    OSVA_M20_7_MAX_TOTAL_DURATION_MS: "180000",
    OSVA_M20_7_MAX_COST_USD_MICROS:
      base.OSVA_M20_7_MAX_COST_USD_MICROS?.trim() ?? "250000",
    OSVA_BUILDER_GENERATION_MAX_PROVIDER_INVOCATIONS: "1",
  };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function geminiGenerationProbeExecuteBlockedReason(env) {
  const preflight = evaluateLivePreflight(env, { provider: "gemini" });
  if (!preflight.ok) {
    return preflight.reason;
  }
  const requested =
    env.OSVA_M20_7_GENERATION_MODEL?.trim() ?? M20_7_DEFAULT_GEMINI_MODEL;
  if (requested !== M20_7_DEFAULT_GEMINI_MODEL) {
    return `PROBE_MODEL_MISMATCH:expected ${M20_7_DEFAULT_GEMINI_MODEL}`;
  }
  const execute = liveExecuteBlockedReason(env, { provider: "gemini" });
  if (execute !== undefined) {
    return execute;
  }
  return geminiProbeWorstCaseCostBlockedReason(env);
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function estimateGeminiProbeWorstCaseMicroUsd(env) {
  const model =
    env.OSVA_M20_7_GENERATION_MODEL?.trim() ?? M20_7_DEFAULT_GEMINI_MODEL;
  const { config } = loadAndValidateBudgetFromEnv(env, {
    live: true,
    smoke: true,
  });
  return worstCaseAttemptCostMicroUsd(model, {
    maxInputTokens: config.maxInputTokensPerAttempt,
    maxOutputTokens: config.maxOutputTokensPerAttempt,
  });
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function geminiProbeWorstCaseCostBlockedReason(env) {
  const { config } = loadAndValidateBudgetFromEnv(env, {
    live: true,
    smoke: true,
  });
  if (config.maxEstimatedCostUsdMicros === undefined) {
    return "OSVA_M20_7_MAX_COST_USD_MICROS missing";
  }
  const worst = estimateGeminiProbeWorstCaseMicroUsd(env);
  if (worst.estimatedMicroUsd === undefined) {
    return worst.reason ?? "UNKNOWN_MODEL_PRICING";
  }
  if (worst.estimatedMicroUsd > config.maxEstimatedCostUsdMicros) {
    return "MAX_ESTIMATED_COST";
  }
  return undefined;
}
