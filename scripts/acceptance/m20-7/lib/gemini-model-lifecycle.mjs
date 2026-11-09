/**
 * Explicit Gemini model lifecycle for M20.7 live acceptance (no broad heuristics).
 */

export const M20_7_DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/** Models retired from the Gemini Developer API — block live preflight when selected. */
/** @type {ReadonlySet<string>} */
export const RETIRED_GEMINI_MODEL_IDS = new Set(["gemini-2.0-flash"]);

/**
 * @param {string} modelId
 * @returns {string | undefined} preflight block reason
 */
export function geminiModelLivePreflightError(modelId) {
  const key = modelId.trim();
  if (RETIRED_GEMINI_MODEL_IDS.has(key)) {
    return `RETIRED_GEMINI_MODEL:${key}`;
  }
  return undefined;
}
