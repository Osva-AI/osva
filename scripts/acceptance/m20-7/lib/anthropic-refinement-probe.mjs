import {
  anthropicGenerationProbeBaseEnv,
  anthropicGenerationProbeExecuteBlockedReason,
  estimateAnthropicProbeWorstCaseMicroUsd,
} from "./anthropic-generation-probe.mjs";

export const M20_7_ANTHROPIC_REFINEMENT_PROBE_ARTIFACT =
  "anthropic-refinement-probe.json";
export const M20_7_ANTHROPIC_GENERATION_PROBE_ARTIFACT =
  "anthropic-generation-probe.json";

/**
 * @param {string | undefined} outcome
 * @returns {number}
 */
export function anthropicRefinementProbeExecuteExitCode(outcome) {
  if (outcome === "BUILDER_REFINEMENT_PASS") {
    return 0;
  }
  if (outcome === "PROBE_DRY_RUN" || outcome === "PROBE_BLOCKED") {
    return 0;
  }
  return 1;
}

export const anthropicRefinementProbeBaseEnv = anthropicGenerationProbeBaseEnv;
export const anthropicRefinementProbeExecuteBlockedReason =
  anthropicGenerationProbeExecuteBlockedReason;
export const estimateAnthropicRefinementProbeWorstCaseMicroUsd =
  estimateAnthropicProbeWorstCaseMicroUsd;
