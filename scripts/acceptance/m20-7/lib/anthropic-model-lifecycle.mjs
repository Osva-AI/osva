/**
 * Explicit Anthropic model lifecycle for M20.7.4 live acceptance.
 */

export const M20_7_DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

/** Models blocked from live builder acceptance until explicitly re-enabled. */
export const RETIRED_ANTHROPIC_MODEL_IDS = new Set([]);

/**
 * @param {string} modelId
 * @returns {string | undefined}
 */
export function anthropicModelLivePreflightError(modelId) {
  const key = modelId.trim();
  if (RETIRED_ANTHROPIC_MODEL_IDS.has(key)) {
    return `RETIRED_ANTHROPIC_MODEL:${key}`;
  }
  return undefined;
}
