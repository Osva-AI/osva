import { INFERENCE_MODEL_INVOCATION_SOURCES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { buildModelRunStepFinalizeProps } from "../src/model-run-step-finalize.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("buildModelRunStepFinalizeProps", () => {
  it("persists OSVA cache hit provenance without provider usage", () => {
    const props = buildModelRunStepFinalizeProps({
      status: "SUCCEEDED",
      completedAt: NOW,
      version: null,
      outcome: {
        text: "cached",
        finishReason: "stop",
        invocationSource: INFERENCE_MODEL_INVOCATION_SOURCES[2],
        estimatedAvoidedCostUsdMicros: null,
      },
    });

    expect(props.modelInvocationSource).toBe(
      INFERENCE_MODEL_INVOCATION_SOURCES[2],
    );
    expect(props.inputTokens).toBeUndefined();
    expect(props.providerRequestId).toBeUndefined();
    expect(props.estimatedCostUsdMicros).toBeNull();
    expect(props.estimatedAvoidedCostUsdMicros).toBeNull();
  });

  it("preserves provider usage for provider prompt-cache hits", () => {
    const props = buildModelRunStepFinalizeProps({
      status: "SUCCEEDED",
      completedAt: NOW,
      version: null,
      outcome: {
        text: "from-provider",
        finishReason: "stop",
        invocationSource: INFERENCE_MODEL_INVOCATION_SOURCES[1],
        usage: {
          inputTokens: 100,
          outputTokens: 5,
          totalTokens: 105,
          cachedInputTokens: 40,
        },
      },
    });

    expect(props.modelInvocationSource).toBe(
      INFERENCE_MODEL_INVOCATION_SOURCES[1],
    );
    expect(props.inputTokens).toBe(100);
    expect(props.cachedInputTokens).toBe(40);
  });
});
