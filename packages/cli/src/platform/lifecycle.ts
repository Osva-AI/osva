import {
  assertComposeSuccess,
  buildComposeSpawnEnv,
  composeCommandIncludesDestructiveVolumeRemoval,
  runComposeCommand,
} from "../setup/compose-exec.js";
import { redactSecrets } from "../doctor/redact.js";
import type { ProbeSpawnFn } from "../setup/probe-spawn.js";
import {
  inspectComposeServices,
  migrateJobCompleted,
} from "./compose-inspect.js";
import { probeInstallationReadiness } from "./readiness.js";
import {
  PLATFORM_APPLICATION_SERVICES,
  PLATFORM_DATA_SERVICES,
  PLATFORM_LIFECYCLE_SERVICES,
} from "./services.js";
import { assertPlatformLifecycleAllowed } from "./upgrade-guard.js";
import { PlatformCommandError, type ResolvedInstallation } from "./types.js";

export const COMPOSE_LIFECYCLE_TIMEOUT_MS = 900_000;

export interface LifecycleActionResult {
  readonly action: "start" | "stop" | "restart";
  readonly servicesAffected: readonly string[];
  readonly message: string;
}

export async function runPlatformStart(
  installation: ResolvedInstallation,
  deps: {
    readonly spawn?: ProbeSpawnFn;
    readonly fetch?: typeof fetch;
  } = {},
): Promise<LifecycleActionResult> {
  await assertPlatformLifecycleAllowed(
    installation.installDir,
    "start platform services",
  );
  const spawn = deps.spawn;
  const servicesBefore = inspectComposeServices(installation.execCtx, spawn);
  const migrateCompleted = migrateJobCompleted(servicesBefore);
  if (migrateCompleted === false) {
    throw new PlatformCommandError(
      "platform_not_ready",
      "Database migration has not completed successfully. Run `osva setup --yes` to migrate before starting the platform (lifecycle start does not run migrations).",
    );
  }

  startDataServices(installation, spawn);
  startApplicationServices(installation, spawn);

  const readiness = await probeInstallationReadiness(
    installation,
    deps.fetch ?? fetch,
  );
  if (!readiness.apiReadyOk) {
    const detail =
      readiness.apiReadyDetail === undefined
        ? ""
        : ` (${readiness.apiReadyDetail})`;
    throw new PlatformCommandError(
      "platform_not_ready",
      `Platform services started but the control plane is not ready${detail}. This can indicate schema drift or unhealthy dependencies. Inspect logs with \`osva platform logs --service web\`; migrations are not run automatically during start.`,
    );
  }

  return {
    action: "start",
    servicesAffected: [...PLATFORM_LIFECYCLE_SERVICES],
    message:
      "OSVA platform services are running and the control plane reported ready.",
  };
}

export async function runPlatformStop(
  installation: ResolvedInstallation,
  deps: { readonly spawn?: ProbeSpawnFn } = {},
): Promise<LifecycleActionResult> {
  await assertPlatformLifecycleAllowed(
    installation.installDir,
    "stop platform services",
  );
  const args = ["stop", ...PLATFORM_LIFECYCLE_SERVICES];
  assertLifecycleArgs(args);
  const result = runComposeCommand(installation.execCtx, args, {
    spawn: deps.spawn,
    timeoutMs: COMPOSE_LIFECYCLE_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(installation.execCtx),
  });
  if (result.status !== 0 && result.status !== null) {
    throw new PlatformCommandError(
      "compose_failed",
      redactSecrets(
        firstLine(result.stderr) ||
          firstLine(result.stdout) ||
          "docker compose stop failed.",
      ),
    );
  }
  return {
    action: "stop",
    servicesAffected: [...PLATFORM_LIFECYCLE_SERVICES],
    message:
      "Stopped OSVA platform services (volumes and installation files preserved).",
  };
}

export async function runPlatformRestart(
  installation: ResolvedInstallation,
  deps: {
    readonly spawn?: ProbeSpawnFn;
    readonly fetch?: typeof fetch;
  } = {},
): Promise<LifecycleActionResult> {
  await assertPlatformLifecycleAllowed(
    installation.installDir,
    "restart platform services",
  );
  const args = ["restart", ...PLATFORM_LIFECYCLE_SERVICES];
  assertLifecycleArgs(args);
  const result = runComposeCommand(installation.execCtx, args, {
    spawn: deps.spawn,
    timeoutMs: COMPOSE_LIFECYCLE_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(installation.execCtx),
  });
  if (result.status !== 0) {
    throw new PlatformCommandError(
      "compose_failed",
      redactSecrets(
        firstLine(result.stderr) ||
          firstLine(result.stdout) ||
          "docker compose restart failed.",
      ),
    );
  }

  let apiHealthOk = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const readiness = await probeInstallationReadiness(
      installation,
      deps.fetch ?? fetch,
    );
    if (readiness.apiHealthOk) {
      apiHealthOk = true;
      break;
    }
    await delay(2_000);
  }
  if (!apiHealthOk) {
    throw new PlatformCommandError(
      "platform_not_ready",
      "Services restarted but the control plane health endpoint is not OK yet. Retry `osva platform status` or inspect logs.",
    );
  }

  return {
    action: "restart",
    servicesAffected: [...PLATFORM_LIFECYCLE_SERVICES],
    message: `Restarted: ${PLATFORM_LIFECYCLE_SERVICES.join(", ")}.`,
  };
}

function startDataServices(
  installation: ResolvedInstallation,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = [
    "up",
    "-d",
    "--no-build",
    "--pull",
    "never",
    "--wait",
    ...PLATFORM_DATA_SERVICES,
  ];
  assertLifecycleArgs(args);
  const result = runComposeCommand(installation.execCtx, args, {
    spawn,
    timeoutMs: COMPOSE_LIFECYCLE_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(installation.execCtx),
  });
  assertComposeSuccess(result, "Starting PostgreSQL and Valkey");
}

function startApplicationServices(
  installation: ResolvedInstallation,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = [
    "up",
    "-d",
    "--no-build",
    "--pull",
    "never",
    "--wait",
    ...PLATFORM_APPLICATION_SERVICES,
  ];
  assertLifecycleArgs(args);
  const result = runComposeCommand(installation.execCtx, args, {
    spawn,
    timeoutMs: COMPOSE_LIFECYCLE_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(installation.execCtx),
  });
  assertComposeSuccess(result, "Starting OSVA application services");
}

function assertLifecycleArgs(args: readonly string[]): void {
  if (composeCommandIncludesDestructiveVolumeRemoval(args)) {
    throw new Error("Refusing destructive docker compose down -v.");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}
