import type { ProbeSpawnFn } from "../setup/probe-spawn.js";
import {
  inspectComposeServices,
  migrateJobCompleted,
} from "./compose-inspect.js";
import { probeInstallationReadiness } from "./readiness.js";
import { KNOWN_COMPOSE_SERVICES } from "./services.js";
import { isIncompleteUpgrade, readUpgradeState } from "./upgrade/state.js";
import type {
  PlatformStatusReport,
  ResolvedInstallation,
  ServiceRuntimeState,
} from "./types.js";

export async function collectPlatformStatus(
  installation: ResolvedInstallation,
  deps: { readonly fetch?: typeof fetch; readonly spawn?: ProbeSpawnFn } = {},
): Promise<PlatformStatusReport> {
  const upgradeState = await readUpgradeState(installation.installDir);
  const services = inspectComposeServices(installation.execCtx, deps.spawn);
  const readiness = await probeInstallationReadiness(
    installation,
    deps.fetch ?? fetch,
  );

  const problems: string[] = [];
  if (isIncompleteUpgrade(upgradeState)) {
    problems.push(
      `Platform upgrade state: ${upgradeState!.phase}${upgradeState!.lastError === undefined ? "" : ` (${upgradeState!.lastError})`}.`,
    );
  }
  for (const expected of KNOWN_COMPOSE_SERVICES) {
    if (!services.some((service) => service.name === expected)) {
      problems.push(`Missing Compose service record for '${expected}'.`);
    }
  }

  const migrateCompleted = migrateJobCompleted(services);
  if (migrateCompleted === false) {
    problems.push(
      "Database migration job has not completed successfully; platform applications may fail to start.",
    );
  }

  for (const service of services) {
    if (
      service.state === "unhealthy" ||
      (service.state === "running" &&
        service.name !== "migrate" &&
        service.statusText.toLowerCase().includes("health") &&
        !service.statusText.toLowerCase().includes("healthy"))
    ) {
      problems.push(
        `Service '${service.name}' is unhealthy (${service.statusText}).`,
      );
    }
  }

  if (!readiness.apiHealthOk) {
    problems.push("Control plane /health is not OK.");
  }
  if (!readiness.apiReadyOk) {
    const detail =
      readiness.apiReadyDetail === undefined
        ? ""
        : `: ${readiness.apiReadyDetail}`;
    problems.push(`Control plane /ready is not OK${detail}.`);
  }
  if (!readiness.consoleReady) {
    problems.push(`Console is not reachable at ${installation.consoleUrl}.`);
  }

  const platformReady = readiness.apiReadyOk && !hasUnhealthyCore(services);

  return {
    installation,
    services,
    platformReady,
    consoleReady: readiness.consoleReady,
    apiHealthOk: readiness.apiHealthOk,
    apiReadyOk: readiness.apiReadyOk,
    problems,
    upgradeState,
  };
}

function hasUnhealthyCore(
  services: readonly {
    readonly name: string;
    readonly state: ServiceRuntimeState;
  }[],
): boolean {
  const core = new Set(["postgres", "valkey", "web", "worker"]);
  return services.some(
    (service) =>
      core.has(service.name) &&
      (service.state === "unhealthy" || service.state === "stopped"),
  );
}
