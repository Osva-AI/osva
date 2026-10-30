import { access } from "node:fs/promises";
import path from "node:path";

import {
  detectShellEnvConflicts,
  readInstallEnvFile,
  type InstallEnvKey,
  type InstallEnvValues,
  INSTALL_ENV_KEYS,
} from "../setup/env-file.js";
import { deriveComposeProjectName } from "../setup/compose-project.js";
import {
  assessInstallDirectory,
  INSTALLATION_MARKER_RELATIVE,
  type InstallationMarker,
} from "../setup/installation-state.js";
import type { ComposeExecContext } from "../setup/compose-exec.js";
import { resolveInstallDir } from "../setup/install-path.js";
import { isIncompleteUpgrade, readUpgradeState } from "./upgrade/state.js";
import { PlatformCommandError, type ResolvedInstallation } from "./types.js";

export async function resolveInstallationForLifecycle(
  flags: Readonly<Record<string, string | boolean>>,
  processEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedInstallation> {
  const installDir = resolveInstallDir(flags, processEnv, platform);
  const assessment = await assessInstallDirectory(installDir);

  if (assessment.kind === "missing") {
    throw new PlatformCommandError(
      "installation_missing",
      `No OSVA installation at ${installDir}. Run \`osva setup\` to install first.`,
    );
  }
  if (assessment.kind === "empty") {
    throw new PlatformCommandError(
      "installation_missing",
      `Installation directory ${installDir} is empty. Run \`osva setup\` to install OSVA.`,
    );
  }
  if (assessment.kind === "foreign") {
    throw new PlatformCommandError(
      "installation_invalid",
      `Directory ${installDir} is not an OSVA installation (unrelated files: ${assessment.foreignEntries.join(", ")}).`,
    );
  }
  if (assessment.marker === undefined) {
    throw new PlatformCommandError(
      "installation_invalid",
      `Missing or invalid installation marker at ${path.join(installDir, INSTALLATION_MARKER_RELATIVE)}.`,
    );
  }

  const composePath = path.join(installDir, "compose.yml");
  const envPath = path.join(installDir, ".env");
  await assertReadableFile(composePath, "compose.yml");
  await assertReadableFile(envPath, ".env");

  const marker = assessment.marker;
  validateMarkerPaths(installDir, marker);

  const envMap = await readInstallEnvFile(envPath);
  if (envMap === undefined) {
    throw new PlatformCommandError(
      "installation_invalid",
      `Could not read installation environment at ${envPath}.`,
    );
  }
  const envValues = installEnvValuesFromMap(envMap);
  await validateMarkerMetadata(marker, installDir, envValues);

  const conflicts = detectShellEnvConflicts(envValues, processEnv);
  if (conflicts.length > 0) {
    const keys = conflicts.map((conflict) => conflict.key).join(", ");
    throw new PlatformCommandError(
      "env_conflict",
      `Host environment variables override installation secrets and differ from .env: ${keys}. Unset them or align values before continuing.`,
    );
  }

  const execCtx: ComposeExecContext = {
    installDir,
    envFilePath: envPath,
    projectName: envValues.COMPOSE_PROJECT_NAME,
  };

  const webPort = Number(envValues.OSVA_PUBLISH_WEB_PORT);
  const mcpPort = Number(envValues.OSVA_PUBLISH_MCP_PORT);
  const consolePort = Number(envValues.OSVA_PUBLISH_CONSOLE_PORT);

  return {
    installDir,
    marker,
    envValues,
    envPath,
    composePath,
    execCtx,
    webUrl: `http://127.0.0.1:${String(webPort)}`,
    mcpUrl: `http://127.0.0.1:${String(mcpPort)}`,
    consoleUrl: `http://127.0.0.1:${String(consolePort)}`,
  };
}

export function installEnvValuesFromMap(
  envMap: Map<string, string>,
): InstallEnvValues {
  const values = {} as InstallEnvValues;
  const missing: InstallEnvKey[] = [];
  for (const key of INSTALL_ENV_KEYS) {
    const raw = envMap.get(key)?.trim();
    if (raw === undefined || raw.length === 0) {
      missing.push(key);
      continue;
    }
    values[key] = raw;
  }
  if (missing.length > 0) {
    throw new PlatformCommandError(
      "installation_invalid",
      `Installation .env is missing required keys: ${missing.join(", ")}.`,
    );
  }
  return values;
}

function validateMarkerPaths(
  installDir: string,
  marker: InstallationMarker,
): void {
  const normalizedInstallDir = normalizePath(installDir);
  const normalizedMarkerDir = normalizePath(marker.installDir);
  if (
    normalizedInstallDir !== normalizedMarkerDir &&
    !pathsEquivalent(normalizedInstallDir, normalizedMarkerDir)
  ) {
    throw new PlatformCommandError(
      "installation_invalid",
      `Installation marker installDir (${marker.installDir}) does not match the requested directory (${installDir}). Use --install-dir ${marker.installDir} or repair ${INSTALLATION_MARKER_RELATIVE}.`,
    );
  }
}

async function validateMarkerMetadata(
  marker: InstallationMarker,
  installDir: string,
  envValues: InstallEnvValues,
): Promise<void> {
  const expectedProject = deriveComposeProjectName(installDir);
  if (envValues.COMPOSE_PROJECT_NAME !== marker.composeProjectName) {
    throw new PlatformCommandError(
      "installation_invalid",
      `Compose project name in .env (${envValues.COMPOSE_PROJECT_NAME}) does not match installation marker (${marker.composeProjectName}).`,
    );
  }
  if (expectedProject !== marker.composeProjectName) {
    throw new PlatformCommandError(
      "installation_invalid",
      `Installation marker project name (${marker.composeProjectName}) does not match this install directory (expected ${expectedProject}). Repair ${INSTALLATION_MARKER_RELATIVE} or use the correct --install-dir.`,
    );
  }
  if (envValues.OSVA_IMAGE !== marker.imageRef) {
    const upgradeState = await readUpgradeState(installDir);
    if (upgradeState !== undefined && isIncompleteUpgrade(upgradeState)) {
      return;
    }
    throw new PlatformCommandError(
      "installation_invalid",
      `Installed image in .env (${envValues.OSVA_IMAGE}) does not match installation marker (${marker.imageRef}). Repair metadata or run \`osva platform upgrade --dry-run\`.`,
    );
  }
}

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

function pathsEquivalent(left: string, right: string): boolean {
  return (
    left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
  );
}

async function assertReadableFile(
  filePath: string,
  label: string,
): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new PlatformCommandError(
      "installation_invalid",
      `Installation is missing ${label} at ${filePath}.`,
    );
  }
}
