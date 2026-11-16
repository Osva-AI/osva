import { describe, expect, it } from "vitest";

import {
  estimateModelCostUsdMicros,
  isModelPricingEligible,
} from "../src/model-cost.js";

const basePricing = {
  currency: "USD" as const,
  inputUsdMicrosPerMillionTokens: 1_000_000,
  outputUsdMicrosPerMillionTokens: 2_000_000,
};

const tieredPricing = {
  ...basePricing,
  cachedReadInputUsdMicrosPerMillionTokens: 100_000,
  cachedWriteInputUsdMicrosPerMillionTokens: 200_000,
};

describe("estimateModelCostUsdMicros", () => {
  it("computes legacy no-cache pricing unchanged", () => {
    const cost = estimateModelCostUsdMicros(
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      basePricing,
      {
        configuredProviderModelId: "gpt-test",
        providerReportedModelId: undefined,
      },
    );

    expect(cost).toBe(2_000_000);
  });

  it("applies tiered cache read, write, uncached input and output once each", () => {
    const cost = estimateModelCostUsdMicros(
      {
        inputTokens: 1_000,
        outputTokens: 200,
        cachedInputTokens: 600,
        cacheWriteInputTokens: 100,
      },
      tieredPricing,
      {
        configuredProviderModelId: "gpt-test",
        providerReportedModelId: "gpt-test-2026-01-01",
      },
    );

    expect(cost).toBe(780);
  });

  it("returns null when cache reads are present but the read rate is missing", () => {
    expect(
      estimateModelCostUsdMicros(
        {
          inputTokens: 100,
          outputTokens: 10,
          cachedInputTokens: 40,
        },
        basePricing,
        {
          configuredProviderModelId: "gpt-test",
          providerReportedModelId: undefined,
        },
      ),
    ).toBeNull();
  });

  it("returns null when cache writes are present but the write rate is missing", () => {
    expect(
      estimateModelCostUsdMicros(
        {
          inputTokens: 100,
          outputTokens: 10,
          cacheWriteInputTokens: 20,
        },
        basePricing,
        {
          configuredProviderModelId: "gpt-test",
          providerReportedModelId: undefined,
        },
      ),
    ).toBeNull();
  });

  it("returns null for incomplete usage", () => {
    expect(
      estimateModelCostUsdMicros(
        { inputTokens: 10, outputTokens: 5 },
        basePricing,
        {
          configuredProviderModelId: "gpt-test",
          providerReportedModelId: undefined,
          usageIncomplete: true,
        },
      ),
    ).toBeNull();
  });

  it("returns null when pricing is absent", () => {
    expect(
      estimateModelCostUsdMicros(
        { inputTokens: 100, outputTokens: 50 },
        undefined,
        {
          configuredProviderModelId: "gpt-test",
          providerReportedModelId: undefined,
        },
      ),
    ).toBeNull();
  });

  it("accepts genuine zero-token usage with zero cost", () => {
    expect(
      estimateModelCostUsdMicros(
        { inputTokens: 0, outputTokens: 0 },
        basePricing,
        {
          configuredProviderModelId: "gpt-test",
          providerReportedModelId: undefined,
        },
      ),
    ).toBe(0);
  });

  it("returns null when cache breakdown exceeds input", () => {
    expect(
      estimateModelCostUsdMicros(
        {
          inputTokens: 50,
          outputTokens: 10,
          cachedInputTokens: 40,
          cacheWriteInputTokens: 20,
        },
        tieredPricing,
        {
          configuredProviderModelId: "gpt-test",
          providerReportedModelId: undefined,
        },
      ),
    ).toBeNull();
  });

  it("rounds each rate contribution half-up to micro-USD", () => {
    const cost = estimateModelCostUsdMicros(
      { inputTokens: 1, outputTokens: 1 },
      {
        currency: "USD",
        inputUsdMicrosPerMillionTokens: 1,
        outputUsdMicrosPerMillionTokens: 1,
      },
      {
        configuredProviderModelId: "gpt-test",
        providerReportedModelId: undefined,
      },
    );
    expect(cost).toBe(0);
  });
});

describe("isModelPricingEligible", () => {
  it("allows absent provider-reported identity", () => {
    expect(isModelPricingEligible("gpt-4o", undefined)).toBe(true);
  });

  it("rejects unrelated provider-reported models", () => {
    expect(isModelPricingEligible("gpt-4o", "claude-sonnet")).toBe(false);
  });

  it("allows version-suffix aliases", () => {
    expect(isModelPricingEligible("gpt-4o", "gpt-4o-2024-08-06")).toBe(true);
  });

  it("rejects short shared prefixes without a version suffix", () => {
    expect(isModelPricingEligible("gpt", "gpt-4o")).toBe(false);
    expect(isModelPricingEligible("claude", "claude-3-sonnet")).toBe(false);
  });

  it("rejects provider-reported ids shorter than the configured model", () => {
    expect(isModelPricingEligible("gpt-4o-mini", "gpt-4o")).toBe(false);
  });
});
