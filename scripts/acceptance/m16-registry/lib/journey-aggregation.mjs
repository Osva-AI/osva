/** Child check ids recorded during the registry install group. */
export const REGISTRY_INSTALL_JOURNEY_CHILD_IDS = [
  "compose_config",
  "platform_services_ready",
  "console_distribution",
  "console_ready",
  "administrator_bootstrapped",
  "console_security_http",
  "console_security_host",
  "console_security_origin",
  "console_security_forwarded",
  "console_security_publish",
  "administrator_setup_complete",
  "administrator_login",
  "administrator_session",
  "console_onboarding_route",
  "first_agent_run_succeeded",
];

/** Child check ids recorded during the registry lifecycle group. */
export const REGISTRY_LIFECYCLE_JOURNEY_CHILD_IDS = [
  "platform_status",
  "platform_stop",
  "platform_status_stopped",
  "platform_start",
  "platform_restart",
  "platform_doctor",
  "platform_logs",
  "lifecycle_secrets_preserved",
  "console_after_restart",
];

/** @typedef {import("../../m16-2d/report.mjs").AcceptanceReport} AcceptanceReport */

/**
 * @param {AcceptanceReport} report
 * @returns {"PASS" | "FAIL" | "NOT_RUN"}
 */
export function registryInstallJourneyStatus(report) {
  return report.journeyStatusFromChildIds(REGISTRY_INSTALL_JOURNEY_CHILD_IDS);
}

/**
 * @param {AcceptanceReport} report
 * @returns {"PASS" | "FAIL" | "NOT_RUN"}
 */
export function registryLifecycleJourneyStatus(report) {
  return report.journeyStatusFromChildIds(REGISTRY_LIFECYCLE_JOURNEY_CHILD_IDS);
}

/**
 * @param {AcceptanceReport} report
 * @returns {"PASS" | "FAIL" | "NOT_RUN"}
 */
export function registryUpgradeJourneyStatus(report) {
  return report.journeyStatusFromChildren("upgrade_");
}
