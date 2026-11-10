import {
  DEFAULT_BUILDER_GENERATION_LIMITS,
  DEFAULT_BUILDER_REFINEMENT_LIMITS,
  type BuilderGenerationLimitsV1,
  type BuilderRefinementLimitsV1,
} from "@osva/domain/builder";

function maxProviderInvocationsFromEnv(
  env: NodeJS.ProcessEnv,
): number | undefined {
  const raw = env.OSVA_BUILDER_GENERATION_MAX_PROVIDER_INVOCATIONS?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const maxProviderInvocations = Number(raw);
  if (
    !Number.isInteger(maxProviderInvocations) ||
    maxProviderInvocations < 1 ||
    maxProviderInvocations > 8
  ) {
    return undefined;
  }
  return maxProviderInvocations;
}

/**
 * Optional operator override for builder NL generation caps (M20.7 isolated probes).
 * When unset, domain defaults apply.
 */
export function builderGenerationLimitsFromEnv(
  env: NodeJS.ProcessEnv,
): BuilderGenerationLimitsV1 {
  const maxProviderInvocations = maxProviderInvocationsFromEnv(env);
  if (maxProviderInvocations === undefined) {
    return DEFAULT_BUILDER_GENERATION_LIMITS;
  }
  return {
    ...DEFAULT_BUILDER_GENERATION_LIMITS,
    maxProviderInvocations,
  };
}

/**
 * Same env cap as generation. Isolated Anthropic refinement must not allow the
 * domain default of two invocations (automatic repair).
 */
export function builderRefinementLimitsFromEnv(
  env: NodeJS.ProcessEnv,
): BuilderRefinementLimitsV1 {
  const maxProviderInvocations = maxProviderInvocationsFromEnv(env);
  if (maxProviderInvocations === undefined) {
    return DEFAULT_BUILDER_REFINEMENT_LIMITS;
  }
  return {
    ...DEFAULT_BUILDER_REFINEMENT_LIMITS,
    maxProviderInvocations,
  };
}
