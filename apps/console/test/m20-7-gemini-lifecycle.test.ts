import { describe, expect, it } from "vitest";

import {
  M20_7_DEFAULT_GEMINI_MODEL,
  RETIRED_GEMINI_MODEL_IDS,
  geminiModelLivePreflightError,
} from "./integration/m20-7-gemini-model-lifecycle.js";
import { evaluateLivePreflight } from "./integration/m20-7-live-guards.js";
import { estimateUsageCostMicroUsd } from "./integration/m20-7-live-eval.js";

describe("M20.7 Gemini model lifecycle", () => {
  it("blocks retired gemini-2.0-flash", () => {
    expect(RETIRED_GEMINI_MODEL_IDS.has("gemini-2.0-flash")).toBe(true);
    expect(geminiModelLivePreflightError("gemini-2.0-flash")).toBe(
      "RETIRED_GEMINI_MODEL:gemini-2.0-flash",
    );
    const r = evaluateLivePreflight(
      {
        OSVA_M20_7_LIVE: "1",
        OSVA_M20_7_ISOLATED: "1",
        GOOGLE_GEMINI_API_KEY: "test",
        OSVA_M20_7_MAX_COST_USD_MICROS: "1000000",
        OSVA_M20_7_GENERATION_MODEL: "gemini-2.0-flash",
      },
      { provider: "gemini" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("RETIRED_GEMINI_MODEL");
    }
  });

  it("defaults to gemini-3.6-flash for Gemini preflight", () => {
    const r = evaluateLivePreflight(
      {
        OSVA_M20_7_LIVE: "1",
        OSVA_M20_7_ISOLATED: "1",
        GOOGLE_GEMINI_API_KEY: "test",
        OSVA_M20_7_MAX_COST_USD_MICROS: "1000000",
      },
      { provider: "gemini" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.modelId).toBe(M20_7_DEFAULT_GEMINI_MODEL);
    }
  });

  it("estimates cost for gemini-3.6-flash with thinking-inclusive output rate", () => {
    const micro = estimateUsageCostMicroUsd("gemini-3.6-flash", 1000, 200);
    expect(micro).toBe(Math.ceil(750 + 750));
  });
});
