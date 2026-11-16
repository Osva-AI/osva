import { describe, expect, it } from "vitest";

import type {
  NormalizedModelUsage,
  ProviderGenerateTextResult,
} from "../src/usage.js";

describe("ProviderGenerateTextResult compatibility", () => {
  it("allows usage to be omitted without implying zero tokens", () => {
    const outcome: ProviderGenerateTextResult = {
      text: "ok",
      finishReason: "stop",
    };
    expect(outcome.usage).toBeUndefined();
  });

  it("accepts cache-write tokens on normalized usage", () => {
    const usage: NormalizedModelUsage = {
      inputTokens: 150,
      outputTokens: 25,
      totalTokens: 175,
      cachedInputTokens: 100,
      cacheWriteInputTokens: 20,
    };
    expect(usage.cacheWriteInputTokens).toBe(20);
  });

  it("accepts extended provenance and incomplete usage markers", () => {
    const usage: NormalizedModelUsage = {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      incomplete: true,
    };
    const outcome: ProviderGenerateTextResult = {
      text: "ok",
      usage,
      invocation: {
        configuredProviderModelId: "gpt-configured",
        providerReportedModelId: "gpt-reported",
      },
      providerRequestId: "req_123",
    };

    expect(outcome.invocation?.configuredProviderModelId).toBe(
      "gpt-configured",
    );
    expect(outcome.usage?.incomplete).toBe(true);
  });
});
