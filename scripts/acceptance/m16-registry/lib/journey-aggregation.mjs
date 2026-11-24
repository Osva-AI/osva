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

/** Additional install checks for OSVA 1.2.0 registry target (`m12-120`). */
export const M12_120_REGISTRY_INSTALL_EXTRA_CHILD_IDS = [
  "release_platform_version",
  "release_pinned_image",
  "release_migration_head",
  "release_web_ready",
  "release_worker_running",
  "aio_inference_routing_list",
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
 * @param {string} [targetId]
 * @returns {"PASS" | "FAIL" | "NOT_RUN"}
 */
export function registryInstallJourneyStatus(report, targetId) {
  const childIds =
    targetId === "m12-120"
      ? [
          ...REGISTRY_INSTALL_JOURNEY_CHILD_IDS,
          ...M12_120_REGISTRY_INSTALL_EXTRA_CHILD_IDS,
        ]
      : REGISTRY_INSTALL_JOURNEY_CHILD_IDS;
  return report.journeyStatusFromChildIds(childIds);
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
