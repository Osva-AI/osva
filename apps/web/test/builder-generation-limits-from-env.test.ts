import { DEFAULT_BUILDER_GENERATION_LIMITS } from "@osva/domain/builder";
import { describe, expect, it } from "vitest";

import { builderGenerationLimitsFromEnv } from "../src/builder-generation-limits-from-env.js";

describe("builderGenerationLimitsFromEnv", () => {
  it("defaults when env unset", () => {
    expect(builderGenerationLimitsFromEnv({})).toEqual(
      DEFAULT_BUILDER_GENERATION_LIMITS,
    );
  });

  it("caps provider invocations for M20.7 probe", () => {
    expect(
      builderGenerationLimitsFromEnv({
        OSVA_BUILDER_GENERATION_MAX_PROVIDER_INVOCATIONS: "1",
      }).maxProviderInvocations,
    ).toBe(1);
  });
});
