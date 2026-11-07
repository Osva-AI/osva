/**
 * M20.6 live routing was removed in M20.7 — always block legacy live entrypoints.
 *
 * @param {NodeJS.ProcessEnv} _env
 * @param {string | undefined} _provider
 * @returns {string | undefined}
 */
export function liveBlockedReason(_env, _provider) {
  return "Use M20.7 harness (pnpm acceptance:m20-7:preflight / acceptance:m20-7:live)";
}
