import {
  createDefaultInferenceRoutingRuntimePolicy,
  estimateRoutingInputTokens,
  estimateRoutingPreflightCostUsdMicros,
  MODEL_INFERENCE_ROUTING_CAPABILITIES,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

describe("inference routing contracts", () => {
  it("defaults routing to disabled", () => {
    expect(createDefaultInferenceRoutingRuntimePolicy()).toEqual({
      schemaVersion: "1",
      enabled: false,
    });
  });

  it("estimates preflight cost from immutable pricing", () => {
    const estimate = estimateRoutingPreflightCostUsdMicros({
      estimatedInputTokens: 1_000,
      maxOutputTokens: 500,
      pricing: {
        currency: "USD",
        inputUsdMicrosPerMillionTokens: 1_000_000,
        outputUsdMicrosPerMillionTokens: 2_000_000,
      },
    });
    expect(estimate.pricingKnown).toBe(true);
    expect(estimate.estimatedCostUsdMicros).toBeGreaterThan(0);
  });

  it("does not invent pricing when unknown", () => {
    const estimate = estimateRoutingPreflightCostUsdMicros({
      estimatedInputTokens: 100,
      maxOutputTokens: 100,
      pricing: undefined,
    });
    expect(estimate.estimatedCostUsdMicros).toBeNull();
  });

  it("documents provider capability matrix", () => {
    expect(MODEL_INFERENCE_ROUTING_CAPABILITIES.OPENAI.supportsStreaming).toBe(
      true,
    );
    expect(
      MODEL_INFERENCE_ROUTING_CAPABILITIES.GOOGLE_GEMINI.contextWindowTokens,
    ).toBeGreaterThan(0);
  });

  it("estimates input tokens with a stable heuristic", () => {
    expect(
      estimateRoutingInputTokens([{ role: "user", content: "abcd" }]),
    ).toBe(1);
  });
});
