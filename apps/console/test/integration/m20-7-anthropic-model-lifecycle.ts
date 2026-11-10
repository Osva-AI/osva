/**
 * TypeScript mirror of `scripts/acceptance/m20-7/lib/anthropic-model-lifecycle.mjs`.
 */

export const M20_7_DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

export const RETIRED_ANTHROPIC_MODEL_IDS: ReadonlySet<string> = new Set([]);

export function anthropicModelLivePreflightError(
  modelId: string,
): string | undefined {
  const key = modelId.trim();
  if (RETIRED_ANTHROPIC_MODEL_IDS.has(key)) {
    return `RETIRED_ANTHROPIC_MODEL:${key}`;
  }
  return undefined;
}
