import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { AgentManifestV1 } from "@osva-ai/contracts";

import {
  sha256IntegrityOf,
  sha256IntegrityOfFile,
} from "../validate/integrity.js";
import { resolvePathInsideRoot } from "../validate/safe-path.js";
import {
  readComposeProjectNameFromFile,
  resolveComposeProjectName,
  resolveComposeTrustedRuntimeVolume,
} from "./compose-volume.js";
import type { ProjectDeployEnv } from "./deploy-env.js";
import { ProjectDeployError } from "./errors.js";

export interface InstalledTrustedRuntime {
  readonly entrypoint: string;
  readonly integrity: string;
  readonly deployTarget: string;
}

export async function installTrustedRuntimeArtifact(input: {
  readonly projectDir: string;
  readonly manifest: AgentManifestV1;
  readonly deployEnv: ProjectDeployEnv;
}): Promise<InstalledTrustedRuntime> {
  const runtime = input.manifest.runtime;
  if (runtime.type !== "TRUSTED_TYPESCRIPT") {
    throw new ProjectDeployError(
      "Only TRUSTED_TYPESCRIPT agents can be deployed from the CLI.",
    );
  }

  const entrypoint = runtime.entrypoint;
  const artifactPath = resolvePathInsideRoot(
    input.projectDir,
    "dist",
    "agent",
    entrypoint,
  );

  if (input.deployEnv.deployMode === "host") {
    return installToHostTrustedRoot(
      input.deployEnv.trustedRuntimeRoot!,
      artifactPath,
      entrypoint,
    );
  }

  return installToComposeVolume(input.deployEnv, artifactPath, entrypoint);
}

async function installToHostTrustedRoot(
  trustedRuntimeRoot: string,
  artifactPath: string,
  entrypoint: string,
): Promise<InstalledTrustedRuntime> {
  await mkdir(trustedRuntimeRoot, { recursive: true });
  const targetPath = path.join(trustedRuntimeRoot, entrypoint);
  await copyFile(artifactPath, targetPath);
  const integrity = await sha256IntegrityOfFile(targetPath);
  return {
    entrypoint,
    integrity,
    deployTarget: targetPath,
  };
}

async function installToComposeVolume(
  deployEnv: ProjectDeployEnv,
  artifactPath: string,
  entrypoint: string,
): Promise<InstalledTrustedRuntime> {
  const composeDir = deployEnv.composeDir!;
  const composeFileProject = await readComposeProjectNameFromFile(
    composeDir,
  ).catch(() => undefined);

  const projectName = resolveComposeProjectName({
    osvaComposeProject: deployEnv.composeProject,
    composeProjectNameEnv: deployEnv.composeProjectNameEnv,
    composeFileNameField: composeFileProject,
  });

  const volumeName = resolveComposeTrustedRuntimeVolume(projectName);
  const sourceDir = path.dirname(artifactPath);

  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/dest`,
      "-v",
      `${sourceDir}:/src:ro`,
      "alpine:3.21",
      "cp",
      `/src/${entrypoint}`,
      `/dest/${entrypoint}`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new ProjectDeployError(
      `Failed to copy agent executable into Compose volume '${volumeName}'.`,
    );
  }

  const integrity = await sha256IntegrityOfVolumeEntrypoint(
    volumeName,
    entrypoint,
  );
  const sourceIntegrity = await sha256IntegrityOfFile(artifactPath);
  if (integrity !== sourceIntegrity) {
    throw new ProjectDeployError(
      `Installed entrypoint digest (${integrity}) does not match compiled executable (${sourceIntegrity}). The worker would reject execution.`,
    );
  }

  return {
    entrypoint,
    integrity,
    deployTarget: `docker-volume:${volumeName}/${entrypoint}`,
  };
}

export async function sha256IntegrityOfVolumeEntrypoint(
  volumeName: string,
  entrypoint: string,
): Promise<string> {
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/dest:ro`,
      "alpine:3.21",
      "cat",
      `/dest/${entrypoint}`,
    ],
    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024, stdio: "pipe" },
  );
  if (result.status !== 0) {
    throw new ProjectDeployError(
      `Trusted runtime entrypoint '${entrypoint}' is missing or unreadable in volume '${volumeName}' after install.`,
    );
  }
  return sha256IntegrityOf(result.stdout);
}
