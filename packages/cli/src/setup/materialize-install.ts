import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { CLI_VERSION } from "../version.js";
import { writeFileAtomic } from "./atomic-write.js";
import type { ComposeDistribution } from "./distribution.js";
import {
  buildInstallEnvValues,
  detectShellEnvConflicts,
  readInstallEnvFile,
  renderInstallEnvFile,
  type InstallEnvValues,
} from "./env-file.js";
import {
  assessInstallDirectory,
  INSTALLATION_MARKER_RELATIVE,
  renderInstallationMarker,
  type InstallDirectoryAssessment,
} from "./installation-state.js";
import { resolveSetupImageRef } from "./acceptance-install.js";
import { deriveComposeProjectName } from "./compose-project.js";
import { generateSecretHex } from "./secrets.js";
import type { SetupOptions } from "./read-options.js";

export interface MaterializeInstallResult {
  readonly assessment: InstallDirectoryAssessment;
  readonly envValues: InstallEnvValues;
  readonly envPath: string;
  readonly composePath: string;
  readonly markerPath: string;
  readonly preservedSecrets: boolean;
  readonly wroteCompose: boolean;
  readonly wroteEnv: boolean;
}

export async function materializeInstallation(input: {
  readonly options: SetupOptions;
  readonly distribution: ComposeDistribution;
  readonly processEnv: NodeJS.ProcessEnv;
}): Promise<MaterializeInstallResult> {
  const installDir = input.options.installDir;
  const assessment = await assessInstallDirectory(installDir);
  if (assessment.kind === "foreign") {
    throw new MaterializeInstallError(
      "foreign_directory",
      `Installation directory contains unrelated files: ${assessment.foreignEntries.join(", ")}`,
    );
  }
  if (assessment.foreignEntries.length > 0) {
    throw new MaterializeInstallError(
      "foreign_directory",
      `Installation directory contains unrelated files: ${assessment.foreignEntries.join(", ")}`,
    );
  }

  await mkdir(installDir, { recursive: true });
  await mkdir(path.join(installDir, ".osva"), { recursive: true });

  const envPath = path.join(installDir, ".env");
  const composePath = path.join(installDir, "compose.yml");
  const markerPath = path.join(installDir, INSTALLATION_MARKER_RELATIVE);

  const existingEnv = await readInstallEnvFile(envPath);
  const preservedSecrets = existingEnv !== undefined;
  const composeProjectName = deriveComposeProjectName(installDir);
  const envValues = buildInstallEnvValues({
    imageRef: resolveSetupImageRef({
      distributionImageRef: input.distribution.manifest.imageRef,
      processEnv: input.processEnv,
    }),
    composeProjectName,
    webPort: input.options.webPort,
    mcpPort: input.options.mcpPort,
    consolePort: input.options.consolePort,
    existing: existingEnv,
    generateSecret: () => generateSecretHex(32),
  });

  const conflicts = detectShellEnvConflicts(envValues, input.processEnv);
  if (conflicts.length > 0) {
    const keys = conflicts.map((conflict) => conflict.key).join(", ");
    throw new MaterializeInstallError(
      "env_conflict",
      `Host environment variables override installation secrets and differ from ${path.basename(envPath)}: ${keys}. Unset them or align values before retrying.`,
    );
  }

  const wroteCompose = await writeComposeIfNeeded(
    composePath,
    input.distribution.composeYaml,
    assessment,
    input.options.authorizeExisting,
  );
  const wroteEnv = await writeEnvIfNeeded(envPath, envValues, existingEnv);
  const marker = renderInstallationMarker({
    platformVersion: input.distribution.manifest.platformVersion,
    imageRef: envValues.OSVA_IMAGE,
    cliVersion: CLI_VERSION,
    installDir,
    composeProjectName: envValues.COMPOSE_PROJECT_NAME,
    existing: assessment.marker,
  });
  await writeFileAtomic(markerPath, `${JSON.stringify(marker, null, 2)}\n`, {
    restrictPermissions: true,
  });

  return {
    assessment,
    envValues,
    envPath,
    composePath,
    markerPath,
    preservedSecrets,
    wroteCompose,
    wroteEnv,
  };
}

async function writeComposeIfNeeded(
  composePath: string,
  composeYaml: string,
  assessment: InstallDirectoryAssessment,
  authorizeExisting: boolean,
): Promise<boolean> {
  const exists = await pathExists(composePath);
  if (exists && assessment.kind === "osva_installation" && !authorizeExisting) {
    return false;
  }
  await writeFileAtomic(composePath, composeYaml);
  return true;
}

async function writeEnvIfNeeded(
  envPath: string,
  values: InstallEnvValues,
  existing: Map<string, string> | undefined,
): Promise<boolean> {
  const rendered = renderInstallEnvFile(values);
  if (existing !== undefined) {
    try {
      const current = await readFile(envPath, "utf8");
      if (current === rendered) {
        return false;
      }
    } catch {
      // write below
    }
  }
  await writeFileAtomic(envPath, rendered, { restrictPermissions: true });
  return true;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class MaterializeInstallError extends Error {
  readonly code: "foreign_directory" | "env_conflict";

  constructor(code: "foreign_directory" | "env_conflict", message: string) {
    super(message);
    this.code = code;
  }
}
