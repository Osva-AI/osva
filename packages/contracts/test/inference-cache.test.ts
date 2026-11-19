import { describe, expect, it } from "vitest";

import {
  INFERENCE_MODEL_INVOCATION_SOURCES,
  createDefaultInferenceResponseCachePolicy,
} from "../src/inference-cache.js";
import { inferenceResponseCachePolicySchema } from "../src/schemas/inference-cache.js";

describe("inference cache contracts", () => {
  it("defaults to disabled fail-closed policy", () => {
    const policy = createDefaultInferenceResponseCachePolicy();
    expect(policy.enabled).toBe(false);
    expect(policy.determinism).toBe("PROVIDER_DEFAULT");
    expect(inferenceResponseCachePolicySchema.safeParse(policy).success).toBe(
      true,
    );
  });

  it("documents distinct invocation accounting sources", () => {
    expect(INFERENCE_MODEL_INVOCATION_SOURCES).toEqual([
      "PROVIDER_INVOKED",
      "PROVIDER_PROMPT_CACHE_HIT",
      "OSVA_RESPONSE_CACHE_HIT",
    ]);
  });
});
