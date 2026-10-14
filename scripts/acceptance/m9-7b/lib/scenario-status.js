/** @typedef {"PASS" | "FAIL" | "BLOCKED" | "NOT_RUN"} ScenarioStatus */

/**
 * Map scenario runner errors to report status.
 * @param {string} message
 * @returns {ScenarioStatus}
 */
export function classifyScenarioError(message) {
  if (message.startsWith("NOT_RUN:") || message.includes("NOT_RUN:")) {
    return "NOT_RUN";
  }
  if (message.startsWith("BLOCKED:") || message.includes("BLOCKED:")) {
    return "BLOCKED";
  }
  return "FAIL";
}

/**
 * @param {ScenarioStatus} status
 * @param {boolean} mandatory
 */
export function failsMandatoryGroup(status, mandatory) {
  return mandatory && (status === "FAIL" || status === "BLOCKED");
}
