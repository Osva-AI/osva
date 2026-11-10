import {
  DEFAULT_BUILDER_GENERATION_LIMITS,
  DEFAULT_BUILDER_REFINEMENT_LIMITS,
} from "@osva/domain/builder";
import { describe, expect, it } from "vitest";

import {
  builderGenerationLimitsFromEnv,
  builderRefinementLimitsFromEnv,
} from "../src/builder-generation-limits-from-env.js";

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

describe("builderRefinementLimitsFromEnv", () => {
  it("defaults when env unset", () => {
    expect(builderRefinementLimitsFromEnv({})).toEqual(
      DEFAULT_BUILDER_REFINEMENT_LIMITS,
    );
    expect(builderRefinementLimitsFromEnv({}).maxProviderInvocations).toBe(2);
  });

  it("caps provider invocations so isolated refinement cannot repair", () => {
    expect(
      builderRefinementLimitsFromEnv({
        OSVA_BUILDER_GENERATION_MAX_PROVIDER_INVOCATIONS: "1",
      }).maxProviderInvocations,
    ).toBe(1);
  });
});
