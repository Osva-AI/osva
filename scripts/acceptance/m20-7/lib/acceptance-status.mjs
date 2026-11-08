/**
 * @param {readonly { status?: string }[]} results
 * @param {{ liveProviderCalls: boolean, allScenariosExecuted: boolean }} options
 * @returns {"PASS" | "PARTIAL" | "FAIL" | "ERROR" | "NOT_RUN"}
 */
export function deriveOverallStatusFromScenarios(results, options) {
  if (!options.allScenariosExecuted || results.length === 0) {
    return "NOT_RUN";
  }
  if (results.some((r) => r.status === "ERROR")) {
    return "ERROR";
  }
  if (results.some((r) => r.status === "FAIL")) {
    return "FAIL";
  }
  if (results.every((r) => r.status === "PASS")) {
    return options.liveProviderCalls ? "PASS" : "FAIL";
  }
  return "PARTIAL";
}

/**
 * @param {string} overallStatus
 * @param {{ liveExecuteAttempted: boolean, allScenariosExecuted: boolean }} options
 */
export function liveAcceptanceShouldExitNonZero(overallStatus, options) {
  if (!options.liveExecuteAttempted || !options.allScenariosExecuted) {
    return false;
  }
  return (
    overallStatus === "FAIL" ||
    overallStatus === "ERROR" ||
    overallStatus === "PARTIAL"
  );
}
