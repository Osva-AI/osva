/**
 * TypeScript mirror of `scripts/acceptance/m20-7/lib/live-guards.mjs` for integration tests.
 * Keeps billable authorization checks independent of ambient terminal env flags.
 */

import {
  M20_7_DEFAULT_GEMINI_MODEL,
  geminiModelLivePreflightError,
} from "./m20-7-gemini-model-lifecycle.js";

export type M20_7LiveGuardEnv = Record<string, string | undefined>;

const CI_MARKERS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "TF_BUILD",
  "BUILDKITE",
] as const;

export function isCiEnvironment(env: M20_7LiveGuardEnv): boolean {
  return CI_MARKERS.some((k) => env[k] === "true" || env[k] === "1");
}

export function evaluateLivePreflight(
  env: M20_7LiveGuardEnv,
  options: { provider?: string; smoke?: boolean } = {},
):
  | { ok: true; provider: string; modelId: string }
  | { ok: false; reason: string } {
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

  if (provider !== "openai" && provider !== "gemini") {
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

  const modelId =
    env.OSVA_M20_7_GENERATION_MODEL?.trim() ??
    (provider === "openai" ? "gpt-4o-mini" : M20_7_DEFAULT_GEMINI_MODEL);

  if (modelId.length === 0) {
    return { ok: false, reason: "GENERATION_MODEL missing" };
  }
  if (provider === "gemini") {
    const retired = geminiModelLivePreflightError(modelId);
    if (retired !== undefined) {
      return { ok: false, reason: retired };
    }
  }
  if (/^gpt-m20-6-/.test(modelId)) {
    return { ok: false, reason: "FIXTURE_MODEL_ID_IN_LIVE_MODE" };
  }

  const cap = env.OSVA_M20_7_MAX_COST_USD_MICROS?.trim();
  if (cap === undefined || cap.length === 0 || !/^\d+$/.test(cap)) {
    return { ok: false, reason: "OSVA_M20_7_MAX_COST_USD_MICROS missing" };
  }

  if (env.OSVA_M20_7_ISOLATED !== "1") {
    return { ok: false, reason: "OSVA_M20_7_ISOLATED not set" };
  }

  return { ok: true, provider, modelId };
}

export function liveExecuteBlockedReason(
  env: M20_7LiveGuardEnv,
  options: { provider?: string } = {},
): string | undefined {
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

/** Minimal env for guard unit checks — never inherits billable flags from process.env. */
export function m20_7NonBillableLiveExecuteEnv(
  overrides: M20_7LiveGuardEnv = {},
): M20_7LiveGuardEnv {
  return {
    OSVA_M20_7_LIVE: "1",
    OSVA_M20_7_ISOLATED: "1",
    OPENAI_API_KEY: "sk-m20-7-guard-check",
    OSVA_M20_7_MAX_COST_USD_MICROS: "1000000",
    ...overrides,
  };
}

export function m20_7BillableLiveExecuteEnv(
  overrides: M20_7LiveGuardEnv = {},
): M20_7LiveGuardEnv {
  return {
    ...m20_7NonBillableLiveExecuteEnv(overrides),
    OSVA_M20_7_LIVE_EXECUTE: "1",
    OSVA_M20_7_ALLOW_BILLABLE: "1",
    ...overrides,
  };
}
