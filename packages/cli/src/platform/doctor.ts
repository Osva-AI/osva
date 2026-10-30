import { loadComposeDistribution } from "../setup/distribution.js";
import { defaultProbeSpawn, type ProbeSpawnFn } from "../setup/probe-spawn.js";
import { doctorExitCode } from "../doctor/run-doctor.js";
import type { DoctorCheck, DoctorReport } from "../doctor/types.js";
import { redactSecrets } from "../doctor/redact.js";
import { isIncompleteUpgrade, readUpgradeState } from "./upgrade/state.js";
import { collectPlatformStatus } from "./status.js";
import { resolveInstallDir } from "../setup/install-path.js";
import { resolveInstallationForLifecycle } from "./resolve-installation.js";
import { PlatformCommandError } from "./types.js";

export const PLATFORM_DOCTOR_SUBPROCESS_TIMEOUT_MS = 5_000;

export async function runPlatformDoctor(
  flags: Readonly<Record<string, string | boolean>>,
  processEnv: NodeJS.ProcessEnv = process.env,
  deps: {
    readonly spawn?: ProbeSpawnFn;
    readonly fetch?: typeof fetch;
    readonly platform?: NodeJS.Platform;
  } = {},
): Promise<DoctorReport> {
  const spawn = deps.spawn ?? defaultProbeSpawn;
  const timeoutMs = PLATFORM_DOCTOR_SUBPROCESS_TIMEOUT_MS;
  const checks: DoctorCheck[] = [];

  checks.push(checkDockerCli(spawn, timeoutMs));
  const engine = checkDockerEngine(spawn, timeoutMs);
  checks.push(engine);
  if (engine.status === "PASS") {
    checks.push(checkDockerCompose(spawn, timeoutMs));
  } else {
    checks.push(
      skipCheck(
        "docker_compose",
        "Skipped because Docker Engine is unavailable.",
      ),
    );
  }

  let installation;
  const upgradeState = await readUpgradeState(
    resolveInstallDir(flags, processEnv, deps.platform),
  );
  if (isIncompleteUpgrade(upgradeState)) {
    checks.push(
      warnCheck(
        "upgrade_state",
        `Incomplete platform upgrade recorded (phase ${upgradeState!.phase}).`,
        "See docs/operations/UPGRADE.md and `osva platform status` before retrying.",
      ),
    );
  }

  try {
    installation = await resolveInstallationForLifecycle(
      flags,
      processEnv,
      deps.platform,
    );
    checks.push(
      passCheck(
        "installation_state",
        `Located OSVA installation at ${installation.installDir} (project ${installation.marker.composeProjectName}).`,
      ),
    );
  } catch (error) {
    if (error instanceof PlatformCommandError) {
      checks.push(
        failCheck(
          "installation_state",
          error.message,
          "Run `osva setup` or pass --install-dir to an existing installation.",
        ),
      );
      return finalizeReport(checks);
    }
    throw error;
  }

  try {
    const distribution = await loadComposeDistribution();
    if (
      installation.marker.platformVersion !==
      distribution.manifest.platformVersion
    ) {
      checks.push(
        warnCheck(
          "installation_version",
          `Installation platform version ${installation.marker.platformVersion} differs from CLI bundle ${distribution.manifest.platformVersion}.`,
          "Plan an explicit upgrade with `osva platform upgrade --to <version> --dry-run`.",
        ),
      );
    } else {
      checks.push(
        passCheck(
          "installation_version",
          `Installation platform version ${installation.marker.platformVersion} matches the CLI bundle.`,
        ),
      );
    }
  } catch (error) {
    checks.push(
      warnCheck(
        "installation_version",
        error instanceof Error
          ? error.message
          : "Could not load CLI distribution metadata.",
        "Reinstall or rebuild the OSVA CLI package.",
      ),
    );
  }

  if (installation.envValues.OSVA_IMAGE !== installation.marker.imageRef) {
    checks.push(
      failCheck(
        "installation_image",
        "Installed image metadata mismatch between marker and .env.",
        "Repair installation metadata or rerun setup reconciliation.",
      ),
    );
  } else {
    checks.push(
      passCheck(
        "installation_image",
        `Installed image ${installation.marker.imageRef}.`,
      ),
    );
  }

  const status = await collectPlatformStatus(installation, {
    fetch: deps.fetch,
    spawn: deps.spawn,
  });

  for (const service of status.services) {
    const id = `service_${service.name.replace(/[^a-z0-9]+/gi, "_")}`;
    if (service.state === "healthy") {
      checks.push(
        passCheck(id, `${service.name}: healthy (${service.statusText}).`),
      );
      continue;
    }
    if (service.state === "running" || service.state === "starting") {
      checks.push(
        warnCheck(
          id,
          `${service.name}: ${service.state} (${service.statusText}).`,
          service.name === "web"
            ? "Wait for health checks or inspect logs with `osva platform logs --service web`."
            : "Inspect service logs if the platform remains degraded.",
        ),
      );
      continue;
    }
    if (service.state === "stopped") {
      checks.push(
        warnCheck(
          id,
          `${service.name}: stopped.`,
          "Run `osva platform start` to start the installation.",
        ),
      );
      continue;
    }
    checks.push(
      warnCheck(
        id,
        `${service.name}: ${service.state} (${service.statusText}).`,
        "Inspect Docker state with `osva platform status`.",
      ),
    );
  }

  if (status.apiHealthOk) {
    checks.push(passCheck("api_health", "GET /health succeeded."));
  } else {
    checks.push(
      failCheck(
        "api_health",
        `Control plane /health failed at ${installation.webUrl}.`,
        "Run `osva platform start` or inspect web logs.",
      ),
    );
  }

  if (status.apiReadyOk) {
    checks.push(
      passCheck(
        "api_ready",
        "GET /ready succeeded (PostgreSQL and Valkey reachable from web).",
      ),
    );
  } else {
    checks.push(
      failCheck(
        "api_ready",
        `Control plane /ready failed at ${installation.webUrl}.`,
        "Ensure postgres and valkey are healthy (`osva platform logs --service postgres`).",
      ),
    );
  }

  if (status.consoleReady) {
    checks.push(
      passCheck(
        "console_ready",
        `Console responded at ${installation.consoleUrl}.`,
      ),
    );
  } else {
    checks.push(
      failCheck(
        "console_ready",
        `Console is not reachable at ${installation.consoleUrl}.`,
        "Inspect `osva platform logs --service console`.",
      ),
    );
  }

  for (const problem of status.problems) {
    checks.push(
      warnCheck(
        "platform_status",
        problem,
        "See `osva platform status` for details.",
      ),
    );
  }

  return finalizeReport(checks);
}

export function platformDoctorExitCode(report: DoctorReport): number {
  return doctorExitCode(report);
}

function checkDockerCli(spawn: ProbeSpawnFn, timeoutMs: number): DoctorCheck {
  const result = spawn("docker", ["--version"], timeoutMs);
  if (result.error?.code === "ENOENT") {
    return failCheck(
      "docker_cli",
      "Docker CLI was not found on PATH.",
      "Install Docker Desktop or Docker Engine.",
    );
  }
  if (result.status !== 0) {
    return failCheck(
      "docker_cli",
      redactSecrets("Docker CLI is unavailable."),
      "Install Docker and ensure `docker` is on PATH.",
    );
  }
  return passCheck("docker_cli", "Docker CLI is available.");
}

function checkDockerEngine(
  spawn: ProbeSpawnFn,
  timeoutMs: number,
): DoctorCheck {
  const result = spawn(
    "docker",
    ["info", "--format", "{{.ServerVersion}}"],
    timeoutMs,
  );
  if (result.error?.code === "ENOENT") {
    return failCheck(
      "docker_engine",
      "Docker CLI was not found on PATH.",
      "Install Docker Desktop or Docker Engine.",
    );
  }
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    return failCheck(
      "docker_engine",
      "Docker Engine is not reachable.",
      "Start Docker Desktop or the Docker daemon.",
    );
  }
  return passCheck(
    "docker_engine",
    `Docker Engine is reachable (server ${result.stdout.trim()}).`,
  );
}

function checkDockerCompose(
  spawn: ProbeSpawnFn,
  timeoutMs: number,
): DoctorCheck {
  const result = spawn("docker", ["compose", "version"], timeoutMs);
  if (result.status !== 0) {
    return failCheck(
      "docker_compose",
      "Docker Compose v2 plugin is unavailable.",
      "Install Docker Compose v2 (`docker compose`).",
    );
  }
  return passCheck("docker_compose", "Docker Compose v2 is available.");
}

function passCheck(id: string, message: string): DoctorCheck {
  return { id, status: "PASS", message };
}

function warnCheck(
  id: string,
  message: string,
  remediation: string,
): DoctorCheck {
  return { id, status: "WARN", message, remediation };
}

function failCheck(
  id: string,
  message: string,
  remediation: string,
): DoctorCheck {
  return { id, status: "FAIL", message, remediation };
}

function skipCheck(id: string, message: string): DoctorCheck {
  return { id, status: "SKIP", message };
}

function finalizeReport(checks: DoctorCheck[]): DoctorReport {
  const hasFail = checks.some((check) => check.status === "FAIL");
  const hasWarn = checks.some((check) => check.status === "WARN");
  const result = hasFail ? "fail" : hasWarn ? "warn" : "pass";
  return { result, checks };
}
