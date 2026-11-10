import { loadAndValidateBudgetFromEnv } from "./budgets.mjs";
import {
  M20_7_DEFAULT_ANTHROPIC_MODEL,
  anthropicModelLivePreflightError,
} from "./anthropic-model-lifecycle.mjs";
import {
  M20_7_DEFAULT_GEMINI_MODEL,
  geminiModelLivePreflightError,
} from "./gemini-model-lifecycle.mjs";

const CI_MARKERS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "TF_BUILD",
  "BUILDKITE",
];

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function isCiEnvironment(env) {
  return CI_MARKERS.some((k) => env[k] === "true" || env[k] === "1");
}

/**
 * Preflight only — does not authorize billable execution.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{ provider?: string, smoke?: boolean }} options
 * @returns {{ ok: true, provider: string, modelId: string, budgets: import("./budgets.mjs").M20_7BudgetConfig } | { ok: false, reason: string }}
 */
export function evaluateLivePreflight(env, options = {}) {
  if (isCiEnvironment(env) && env.OSVA_M20_7_ALLOW_CI_LIVE !== "1") {
    return { ok: false, reason: "CI_LIVE_BLOCKED" };
  }
  if (env.OSVA_M20_7_LIVE !== "1") {
    return { ok: false, reason: "OSVA_M20_7_LIVE not set" };
  }

  const provider = (
    options.provider ??
    env.OSVA_M20_7_LIVE_PROVIDER ??
    "openai"
  )
    .trim()
    .toLowerCase();

  if (
    provider !== "openai" &&
    provider !== "gemini" &&
    provider !== "anthropic"
  ) {
    return { ok: false, reason: `UNKNOWN_PROVIDER:${provider}` };
  }

  if (provider === "openai") {
    const key = env.OPENAI_API_KEY?.trim();
    if (key === undefined || key.length === 0) {
      return { ok: false, reason: "OPENAI_API_KEY missing" };
    }
    if (key === "osva-m12-3-sentinel-credential-NEVER-LEAK") {
      return { ok: false, reason: "SENTINEL_OPENAI_KEY_IN_LIVE_MODE" };
    }
  }
  if (provider === "gemini") {
    const key = env.GOOGLE_GEMINI_API_KEY?.trim() ?? env.GEMINI_API_KEY?.trim();
    if (key === undefined || key.length === 0) {
      return { ok: false, reason: "GOOGLE_GEMINI_API_KEY missing" };
    }
  }
  if (provider === "anthropic") {
    const key = env.ANTHROPIC_API_KEY?.trim();
    if (key === undefined || key.length === 0) {
      return { ok: false, reason: "ANTHROPIC_API_KEY missing" };
    }
  }

  const defaultModel =
    provider === "openai"
      ? "gpt-4o-mini"
      : provider === "gemini"
        ? M20_7_DEFAULT_GEMINI_MODEL
        : M20_7_DEFAULT_ANTHROPIC_MODEL;
  const modelId = env.OSVA_M20_7_GENERATION_MODEL?.trim() ?? defaultModel;

  if (modelId.length === 0) {
    return { ok: false, reason: "GENERATION_MODEL missing" };
  }
  if (provider === "gemini") {
    const retired = geminiModelLivePreflightError(modelId);
    if (retired !== undefined) {
      return { ok: false, reason: retired };
    }
  }
  if (provider === "anthropic") {
    const retired = anthropicModelLivePreflightError(modelId);
    if (retired !== undefined) {
      return { ok: false, reason: retired };
    }
  }
  if (/^gpt-m20-6-/.test(modelId)) {
    return { ok: false, reason: "FIXTURE_MODEL_ID_IN_LIVE_MODE" };
  }

  const smoke = env.OSVA_M20_7_SMOKE === "1" || env.OSVA_M20_7_SMOKE === "true";
  const { config, errors } = loadAndValidateBudgetFromEnv(env, {
    live: true,
    smoke,
  });
  if (errors.length > 0) {
    return { ok: false, reason: errors[0] };
  }

  if (env.OSVA_M20_7_ISOLATED !== "1") {
    return { ok: false, reason: "OSVA_M20_7_ISOLATED not set" };
  }

  return { ok: true, provider, modelId, budgets: config };
}

/**
 * Billable execution requires preflight + explicit execute flag.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{ provider?: string }} options
 * @returns {string | undefined}
 */
export function liveExecuteBlockedReason(env, options = {}) {
  const preflight = evaluateLivePreflight(env, options);
  if (!preflight.ok) {
    return preflight.reason;
  }
  if (env.OSVA_M20_7_LIVE_EXECUTE !== "1") {
    return "OSVA_M20_7_LIVE_EXECUTE not set";
  }
  if (env.OSVA_M20_7_ALLOW_BILLABLE !== "1") {
    return "OSVA_M20_7_ALLOW_BILLABLE not set";
  }
  return undefined;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string | undefined} provider
 * @returns {string | undefined}
 */
export function legacyM206LiveBlockedReason(env, provider) {
  return "M20.6 live mode removed — use pnpm acceptance:m20-7:preflight and acceptance:m20-7:live";
}
