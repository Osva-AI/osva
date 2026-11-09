import {
  DEFAULT_BUILDER_GENERATION_LIMITS,
  type BuilderGenerationLimitsV1,
} from "@osva/domain/builder";

/**
 * Optional operator override for builder NL generation caps (M20.7 isolated probes).
 * When unset, domain defaults apply.
 */
export function builderGenerationLimitsFromEnv(
  env: NodeJS.ProcessEnv,
): BuilderGenerationLimitsV1 {
  const raw = env.OSVA_BUILDER_GENERATION_MAX_PROVIDER_INVOCATIONS?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return DEFAULT_BUILDER_GENERATION_LIMITS;
  }
  const maxProviderInvocations = Number(raw);
  if (
    !Number.isInteger(maxProviderInvocations) ||
    maxProviderInvocations < 1 ||
    maxProviderInvocations > 8
  ) {
    return DEFAULT_BUILDER_GENERATION_LIMITS;
  }
  return {
    ...DEFAULT_BUILDER_GENERATION_LIMITS,
    maxProviderInvocations,
  };
}
