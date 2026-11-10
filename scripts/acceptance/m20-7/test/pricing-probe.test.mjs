import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  anthropicGenerationProbeBaseEnv,
  anthropicProbeWorstCaseCostBlockedReason,
  estimateAnthropicProbeWorstCaseMicroUsd,
} from "../lib/anthropic-generation-probe.mjs";
import {
  estimateGeminiProbeWorstCaseMicroUsd,
  geminiGenerationProbeBaseEnv,
  geminiProbeWorstCaseCostBlockedReason,
} from "../lib/gemini-generation-probe.mjs";
import {
  reserveBeforeProviderRequest,
  createBudgetUsageState,
} from "../lib/budgets.mjs";
import {
  lookupModelPricing,
  worstCaseAttemptCostMicroUsd,
} from "../lib/pricing.mjs";

describe("M20.7.3 Gemini probe pricing", () => {
  it("estimates 13824 micro-USD for gemini-3.6-flash at 8192/2048 tokens", () => {
    const worst = worstCaseAttemptCostMicroUsd("gemini-3.6-flash", {
      maxInputTokens: 8192,
      maxOutputTokens: 2048,
    });
    assert.equal(worst.estimatedMicroUsd, 13824);
    assert.equal(worst.reason, undefined);
  });

  it("probe CLI estimate uses harness token ceilings", () => {
    const env = geminiGenerationProbeBaseEnv({
      GOOGLE_GEMINI_API_KEY: "k",
      OSVA_M20_7_MAX_COST_USD_MICROS: "250000",
    });
    const worst = estimateGeminiProbeWorstCaseMicroUsd(env);
    assert.equal(worst.estimatedMicroUsd, 13824);
  });

  it("unknown model pricing is undefined with reason", () => {
    const worst = worstCaseAttemptCostMicroUsd("no-such-model", {
      maxInputTokens: 100,
      maxOutputTokens: 100,
    });
    assert.equal(worst.estimatedMicroUsd, undefined);
    assert.equal(worst.reason, "UNKNOWN_MODEL_PRICING");
    assert.equal(lookupModelPricing("no-such-model"), undefined);
  });

  it("invalid token bounds do not produce finite estimates", () => {
    const worst = worstCaseAttemptCostMicroUsd("gemini-3.6-flash", 2048);
    assert.equal(worst.estimatedMicroUsd, undefined);
    assert.equal(worst.reason, "INVALID_TOKEN_BOUNDS");

    const missingOutput = worstCaseAttemptCostMicroUsd("gemini-3.6-flash", {
      maxInputTokens: 8192,
    });
    assert.equal(missingOutput.estimatedMicroUsd, undefined);
    assert.equal(missingOutput.reason, "INVALID_TOKEN_BOUNDS");
  });

  it("budget reservation blocks unknown pricing under cost cap", () => {
    const usage = createBudgetUsageState();
    const blocked = reserveBeforeProviderRequest(
      usage,
      {
        maxBuilderRequests: 1,
        maxProviderInvocations: 1,
        maxOutputTokensPerAttempt: 2048,
        maxInputTokensPerAttempt: 8192,
        maxTotalDurationMs: 180000,
        maxConsecutiveFailures: 2,
        maxRepairAttempts: 0,
        maxEstimatedCostUsdMicros: 250_000,
        costCapRequired: true,
      },
      { modelId: "unknown-model", kind: "provider" },
    );
    assert.equal(blocked, "UNKNOWN_MODEL_PRICING");
    assert.equal(usage.providerInvocations, 0);
  });

  it("probe cost gate blocks when cap is below worst-case", () => {
    const env = geminiGenerationProbeBaseEnv({
      GOOGLE_GEMINI_API_KEY: "k",
      OSVA_M20_7_MAX_COST_USD_MICROS: "1000",
    });
    assert.equal(
      geminiProbeWorstCaseCostBlockedReason(env),
      "MAX_ESTIMATED_COST",
    );
  });

  it("probe cost gate passes under default cap", () => {
    const env = geminiGenerationProbeBaseEnv({
      GOOGLE_GEMINI_API_KEY: "k",
      OSVA_M20_7_MAX_COST_USD_MICROS: "250000",
    });
    assert.equal(geminiProbeWorstCaseCostBlockedReason(env), undefined);
  });
});

describe("M20.7.4 Anthropic probe pricing", () => {
  it("estimates 36864 micro-USD for claude-sonnet-5-5 at 8192/2048 tokens", () => {
    const worst = worstCaseAttemptCostMicroUsd("claude-sonnet-5-5", {
      maxInputTokens: 8192,
      maxOutputTokens: 2048,
    });
    assert.equal(worst.estimatedMicroUsd, 36864);
    assert.equal(worst.reason, undefined);
  });

  it("probe cost gate passes under default anthropic probe cap", () => {
    const env = anthropicGenerationProbeBaseEnv({
      ANTHROPIC_API_KEY: "k",
      OSVA_M20_7_MAX_COST_USD_MICROS: "500000",
    });
    assert.equal(anthropicProbeWorstCaseCostBlockedReason(env), undefined);
    assert.equal(
      estimateAnthropicProbeWorstCaseMicroUsd(env).estimatedMicroUsd,
      36864,
    );
  });
});
