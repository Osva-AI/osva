import { describe, expect, it } from "vitest";

import {
  assignBalancedRanks,
  balancedSortKey,
} from "../src/inference-routing/balanced-rank.js";

describe("balanced routing rank", () => {
  it("uses comparable ranks instead of raw cost plus raw latency", () => {
    const ranks = assignBalancedRanks([
      {
        policyIndex: 0,
        cost: {
          estimatedInputTokens: 10,
          estimatedOutputTokens: 10,
          estimatedCostUsdMicros: 5_000,
          pricingKnown: true,
        },
        latency: {
          sampleCount: 10,
          medianCompletionMs: 500,
          sufficientEvidence: true,
        },
      },
      {
        policyIndex: 1,
        cost: {
          estimatedInputTokens: 10,
          estimatedOutputTokens: 10,
          estimatedCostUsdMicros: 1_000,
          pricingKnown: true,
        },
        latency: {
          sampleCount: 10,
          medianCompletionMs: 2_000,
          sufficientEvidence: true,
        },
      },
    ]);

    const expensiveButFast = balancedSortKey(ranks[0]!);
    const cheapButSlow = balancedSortKey(ranks[1]!);
    expect(cheapButSlow).toBeLessThan(expensiveButFast);
  });

  it("penalizes unknown cost and latency with large rank penalty", () => {
    const ranks = assignBalancedRanks([
      {
        policyIndex: 0,
        cost: {
          estimatedInputTokens: 1,
          estimatedOutputTokens: 1,
          estimatedCostUsdMicros: null,
          pricingKnown: false,
        },
        latency: {
          sampleCount: 0,
          medianCompletionMs: null,
          sufficientEvidence: false,
        },
      },
      {
        policyIndex: 1,
        cost: {
          estimatedInputTokens: 1,
          estimatedOutputTokens: 1,
          estimatedCostUsdMicros: 9_999,
          pricingKnown: true,
        },
        latency: {
          sampleCount: 0,
          medianCompletionMs: null,
          sufficientEvidence: false,
        },
      },
    ]);

    expect(balancedSortKey(ranks[0]!)).toBeGreaterThan(
      balancedSortKey(ranks[1]!),
    );
  });
});
