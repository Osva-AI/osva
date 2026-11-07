/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string | undefined} provider
 * @returns {string | undefined}
 */
export function liveBlockedReason(env, provider) {
  if (env.OSVA_M20_6_LIVE !== "1") {
    return "OSVA_M20_6_LIVE not set";
  }
  if (provider === "openai" || provider === undefined) {
    const key = env.OPENAI_API_KEY?.trim();
    if (key === undefined || key.length === 0) {
      return "OPENAI_API_KEY missing";
    }
  }
  if (provider === "gemini") {
    const key = env.GOOGLE_GEMINI_API_KEY?.trim();
    if (key === undefined || key.length === 0) {
      return "GOOGLE_GEMINI_API_KEY missing";
    }
  }
  return undefined;
}
