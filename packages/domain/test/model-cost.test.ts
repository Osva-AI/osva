import { describe, expect, it } from "vitest";

import { estimateModelCostUsdMicros } from "../src/model-cost.js";

describe("estimateModelCostUsdMicros", () => {
  it("computes deterministic micro-USD from immutable pricing", () => {
    const cost = estimateModelCostUsdMicros(
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      {
        currency: "USD",
        inputUsdMicrosPerMillionTokens: 1_000_000,
        outputUsdMicrosPerMillionTokens: 2_000_000,
      },
    );

    expect(cost).toBe(2_000_000);
  });

  it("returns null when pricing is unavailable", () => {
    expect(
      estimateModelCostUsdMicros(
        { inputTokens: 100, outputTokens: 50 },
        undefined,
      ),
    ).toBeNull();
  });
});
