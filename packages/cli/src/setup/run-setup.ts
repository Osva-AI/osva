import { statfsSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";

import { checkNodeRuntime } from "../doctor/run-doctor.js";
import { redactSecrets } from "../doctor/redact.js";
import type { DoctorCheck, DoctorReport } from "../doctor/types.js";
import { CLI_VERSION } from "../version.js";
import {
  defaultProbeSpawn,
  type ProbeSpawnFn,
  type ProbeSpawnResult,
} from "./probe-spawn.js";
import { readInstallEnvFile, type InstallEnvKey } from "./env-file.js";
import type { SetupOptions } from "./read-options.js";

export const DEFAULT_SETUP_SUBPROCESS_TIMEOUT_MS = 5_000;

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>([
  "win32",
  "darwin",
  "linux",
]);

export type LoopbackPortProbeResult =
  | { readonly kind: "available" }
  | { readonly kind: "in_use" }
  | { readonly kind: "permission_denied" }
  | { readonly kind: "probe_error"; readonly code?: string };

export type LoopbackPortProbeFn = (
  port: number,
) => Promise<LoopbackPortProbeResult>;

export interface SetupProbeDependencies {
  readonly spawn?: ProbeSpawnFn;
  readonly probeLoopbackPort?: LoopbackPortProbeFn;
  readonly subprocessTimeoutMs?: number;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly cwdForDisk?: string;
}

export async function runSetupPipeline(
  options: SetupOptions,
  deps: SetupProbeDependencies = {},
): Promise<DoctorReport> {
  const spawn = deps.spawn ?? defaultProbeSpawn;
  const timeoutMs =
    deps.subprocessTimeoutMs ?? DEFAULT_SETUP_SUBPROCESS_TIMEOUT_MS;
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const checks: DoctorCheck[] = [];

  checks.push(checkHostPlatform(platform));
  checks.push(checkHostArchitecture(arch));
  checks.push(checkNodeRuntime());
  checks.push(
    passCheck(
      "cli_version",
      `OSVA CLI ${CLI_VERSION} (installation preflight and provisioning).`,
    ),
  );

  const dockerCli = checkDockerCli(spawn, timeoutMs);
  checks.push(dockerCli);

  if (dockerCli.status !== "PASS") {
    checks.push(
      skipCheck(
        "docker_engine",
        "Skipped because the Docker CLI is unavailable.",
      ),
    );
    checks.push(
      skipCheck(
        "docker_compose",
        "Skipped because the Docker CLI is unavailable.",
      ),
    );
  } else {
    checks.push(checkDockerEngine(spawn, timeoutMs));
    checks.push(checkDockerCompose(spawn, timeoutMs));
  }

  const probeLoopbackPort =
    deps.probeLoopbackPort ?? probeLoopbackPortAvailability;
  const portReconciliation = {
    authorizeExisting: options.authorizeExisting,
    installDir: options.installDir,
  };
  checks.push(
    await checkPublishPort(
      "publish_web_port",
      options.webPort,
      probeLoopbackPort,
      { ...portReconciliation, envKey: "OSVA_PUBLISH_WEB_PORT" },
    ),
  );
  checks.push(
    await checkPublishPort(
      "publish_mcp_port",
      options.mcpPort,
      probeLoopbackPort,
      { ...portReconciliation, envKey: "OSVA_PUBLISH_MCP_PORT" },
    ),
  );
  checks.push(
    await checkPublishPort(
      "publish_console_port",
      options.consolePort,
      probeLoopbackPort,
      { ...portReconciliation, envKey: "OSVA_PUBLISH_CONSOLE_PORT" },
    ),
  );
  checks.push(checkHostMemory());
  checks.push(
    checkHostDiskSpace(deps.cwdForDisk ?? options.installDir ?? process.cwd()),
  );

  return finalizeReport(checks);
}

function checkHostPlatform(platform: NodeJS.Platform): DoctorCheck {
  if (SUPPORTED_PLATFORMS.has(platform)) {
    return passCheck(
      "host_platform",
      `Host OS ${platform} is supported for OSVA Compose installation.`,
    );
  }
  return warnCheck(
    "host_platform",
    `Host OS '${platform}' is not a tested installation platform.`,
    "OSVA self-hosted Compose is validated on Windows, macOS, and Linux.",
  );
}

function checkHostArchitecture(arch: string): DoctorCheck {
  return passCheck("host_architecture", `Host CPU architecture is ${arch}.`);
}

function checkDockerCli(spawn: ProbeSpawnFn, timeoutMs: number): DoctorCheck {
  const result = spawn("docker", ["--version"], timeoutMs);
  const timedOut = mapDockerProbeTimeout(result, "docker_cli");
  if (timedOut !== undefined) {
    return timedOut;
  }
  if (isExecutableMissing(result)) {
    return failCheck(
      "docker_cli",
      "Docker CLI was not found on PATH.",
      "Install Docker Desktop or Docker Engine and ensure `docker` is on PATH.",
    );
  }
  if (result.status !== 0) {
    return failCheck(
      "docker_cli",
      redactSecrets(trimProbeMessage(result, "Docker CLI `--version` failed.")),
      "Reinstall Docker or fix your Docker installation.",
    );
  }
  const versionLine = redactSecrets(
    firstLine(result.stdout) || firstLine(result.stderr),
  );
  return passCheck(
    "docker_cli",
    versionLine.length > 0
      ? `Docker CLI available (${versionLine}).`
      : "Docker CLI available.",
  );
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
  const timedOut = mapDockerProbeTimeout(result, "docker_engine");
  if (timedOut !== undefined) {
    return timedOut;
  }
  if (isExecutableMissing(result)) {
    return failCheck(
      "docker_engine",
      "Docker CLI was not found on PATH.",
      "Install Docker Desktop or Docker Engine and ensure `docker` is on PATH.",
    );
  }
  const serverVersion = result.stdout.trim();
  if (result.status !== 0 || serverVersion.length === 0) {
    return failCheck(
      "docker_engine",
      redactSecrets(
        trimProbeMessage(
          result,
          "Docker Engine is not reachable (daemon not running or permission denied).",
        ),
      ),
      "Start Docker Desktop or the Docker daemon and confirm `docker info` succeeds.",
    );
  }
  return passCheck(
    "docker_engine",
    `Docker Engine is reachable (server ${serverVersion}).`,
  );
}

function checkDockerCompose(
  spawn: ProbeSpawnFn,
  timeoutMs: number,
): DoctorCheck {
  const result = spawn("docker", ["compose", "version"], timeoutMs);
  const timedOut = mapDockerProbeTimeout(result, "docker_compose");
  if (timedOut !== undefined) {
    return timedOut;
  }
  if (isExecutableMissing(result)) {
    return failCheck(
      "docker_compose",
      "Docker CLI was not found on PATH.",
      "Install Docker Desktop or Docker Engine with Compose v2.",
    );
  }
  if (result.status !== 0) {
    return failCheck(
      "docker_compose",
      redactSecrets(
        trimProbeMessage(
          result,
          "Docker Compose v2 plugin is unavailable (`docker compose`).",
        ),
      ),
      "Install Docker Compose v2 (bundled with current Docker Desktop / Engine packages).",
    );
  }
  const versionLine = redactSecrets(
    firstLine(result.stdout) || firstLine(result.stderr),
  );
  return passCheck(
    "docker_compose",
    versionLine.length > 0
      ? `Docker Compose v2 available (${versionLine}).`
      : "Docker Compose v2 available.",
  );
}

async function checkPublishPort(
  id: string,
  port: number,
  probe: LoopbackPortProbeFn,
  reconciliation?: {
    readonly authorizeExisting: boolean;
    readonly installDir: string;
    readonly envKey: InstallEnvKey;
  },
): Promise<DoctorCheck> {
  const probeResult = await probe(port);
  if (probeResult.kind === "available") {
    return passCheck(
      id,
      `Loopback (127.0.0.1) port ${String(port)} appears available; other interfaces were not checked.`,
    );
  }
  if (probeResult.kind === "in_use") {
    if (
      reconciliation?.authorizeExisting === true &&
      (await installEnvPublishPortMatches(
        reconciliation.installDir,
        reconciliation.envKey,
        port,
      ))
    ) {
      return passCheck(
        id,
        `Loopback (127.0.0.1) port ${String(port)} is in use by this installation (expected during --yes reconciliation).`,
      );
    }
    return failCheck(
      id,
      `Loopback (127.0.0.1) port ${String(port)} is already in use.`,
      `Stop the process using port ${String(port)} or choose another port via --web-port / --mcp-port or OSVA_PUBLISH_* env vars.`,
    );
  }
  if (probeResult.kind === "permission_denied") {
    return failCheck(
      id,
      `Loopback (127.0.0.1) port ${String(port)} could not be probed (permission denied).`,
      "Run the CLI with sufficient privileges to bind loopback ports, or choose a different port above 1024.",
    );
  }
  const codeSuffix =
    probeResult.code === undefined ? "" : ` (${probeResult.code})`;
  return failCheck(
    id,
    `Loopback (127.0.0.1) port ${String(port)} could not be probed${codeSuffix}.`,
    `Choose another port via --web-port / --mcp-port or OSVA_PUBLISH_* env vars, then retry.`,
  );
}

async function installEnvPublishPortMatches(
  installDir: string,
  envKey: InstallEnvKey,
  port: number,
): Promise<boolean> {
  const envPath = path.join(installDir, ".env");
  const env = await readInstallEnvFile(envPath);
  return env?.get(envKey) === String(port);
}

function probeLoopbackPortAvailability(
  port: number,
): Promise<LoopbackPortProbeResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;

    const finish = (result: LoopbackPortProbeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      server.close(() => {
        resolve(result);
      });
    };

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        finish({ kind: "in_use" });
        return;
      }
      if (error.code === "EACCES") {
        finish({ kind: "permission_denied" });
        return;
      }
      finish({ kind: "probe_error", code: error.code });
    });

    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      finish({ kind: "available" });
    });
  });
}

function checkHostMemory(): DoctorCheck {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  return passCheck(
    "host_memory",
    `About ${formatBytes(freeBytes)} free of ${formatBytes(totalBytes)} total system memory (informational; no minimum enforced).`,
  );
}

function checkHostDiskSpace(cwd: string): DoctorCheck {
  try {
    const stats = statfsSync(cwd);
    const freeBytes = stats.bfree * stats.bsize;
    return passCheck(
      "host_disk_space",
      `About ${formatBytes(freeBytes)} free on the filesystem containing ${cwd} (informational; no minimum enforced).`,
    );
  } catch {
    return warnCheck(
      "host_disk_space",
      "Could not read free disk space for the current working directory.",
      "Ensure the installation directory resides on a writable volume with adequate space.",
    );
  }
}

function mapDockerProbeTimeout(
  result: ProbeSpawnResult,
  id: string,
): DoctorCheck | undefined {
  if (result.error?.code === "ETIMEDOUT") {
    return failCheck(
      id,
      "Docker command timed out during preflight.",
      "Ensure Docker responds promptly and retry `osva setup`.",
    );
  }
  return undefined;
}

function isExecutableMissing(result: ProbeSpawnResult): boolean {
  return result.error?.code === "ENOENT";
}

function trimProbeMessage(result: ProbeSpawnResult, fallback: string): string {
  const detail = firstLine(result.stderr) || firstLine(result.stdout);
  if (detail.length === 0) {
    return fallback;
  }
  return `${fallback} ${detail}`;
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "unknown";
  }
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) {
    return `${gib.toFixed(1)} GiB`;
  }
  const mib = bytes / 1024 ** 2;
  return `${mib.toFixed(0)} MiB`;
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

export function setupExitCode(report: DoctorReport): number {
  return report.result === "fail" ? 1 : 0;
}
