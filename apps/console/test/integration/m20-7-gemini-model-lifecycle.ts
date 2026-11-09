/**
 * TypeScript mirror of `scripts/acceptance/m20-7/lib/gemini-model-lifecycle.mjs`.
 */

export const M20_7_DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/** Models retired from the Gemini Developer API — block live preflight when selected. */
export const RETIRED_GEMINI_MODEL_IDS: ReadonlySet<string> = new Set([
  "gemini-2.0-flash",
]);

export function geminiModelLivePreflightError(
  modelId: string,
): string | undefined {
  const key = modelId.trim();
  if (RETIRED_GEMINI_MODEL_IDS.has(key)) {
    return `RETIRED_GEMINI_MODEL:${key}`;
  }
  return undefined;
}
