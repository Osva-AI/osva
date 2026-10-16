import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  agentArtifactPath,
  HELLO_AGENT_ENTRYPOINT,
  requiredAgentBuildArtifacts,
} from "./constants.js";
import {
  readComposeProjectNameFromFile,
  resolveComposeProjectName,
  resolveComposeTrustedRuntimeVolume,
} from "./compose-project.js";
import type { HelloEnv } from "./env.js";
import { HelloDeployError } from "./errors.js";
import { sha256IntegrityOf, sha256IntegrityOfFile } from "./integrity.js";

export { HelloDeployError } from "./errors.js";

export interface DeployedHelloRuntime {
  readonly entrypoint: string;
  readonly integrity: string;
  readonly deployTarget: string;
}

export function missingHelloAgentArtifactError(
  artifactPath: string,
): HelloDeployError {
  return new HelloDeployError(
    `Hello Agent executable is missing at '${artifactPath}'. Run 'pnpm --filter @osva/example-hello-agent build' (or 'pnpm example:hello:build') before deploying.`,
  );
}

export async function assertHelloAgentBuildArtifactsExist(): Promise<void> {
  for (const artifactPath of requiredAgentBuildArtifacts()) {
    try {
      await access(artifactPath);
    } catch {
      throw missingHelloAgentArtifactError(artifactPath);
    }
  }
}

export async function deployHelloAgentRuntime(
  env: HelloEnv,
): Promise<DeployedHelloRuntime> {
  await assertHelloAgentBuildArtifactsExist();
  if (env.deployMode === "host") {
    return deployToHostTrustedRoot(env.trustedRuntimeRoot!);
  }
  return deployToComposeVolume(env);
}

async function deployToHostTrustedRoot(
  trustedRuntimeRoot: string,
): Promise<DeployedHelloRuntime> {
  await mkdir(trustedRuntimeRoot, { recursive: true });
  const targetPath = path.join(trustedRuntimeRoot, HELLO_AGENT_ENTRYPOINT);
  await copyFile(agentArtifactPath, targetPath);
  const integrity = await sha256IntegrityOfFile(targetPath);
  return {
    entrypoint: HELLO_AGENT_ENTRYPOINT,
    integrity,
    deployTarget: targetPath,
  };
}

async function deployToComposeVolume(
  env: HelloEnv,
): Promise<DeployedHelloRuntime> {
  const composeFileProject = await readComposeProjectNameFromFile(
    env.composeDir,
  ).catch(() => undefined);

  const projectName = resolveComposeProjectName({
    osvaComposeProject: env.composeProject,
    composeProjectNameEnv: env.composeProjectNameEnv,
    composeFileNameField: composeFileProject,
  });

  const volumeName = resolveComposeTrustedRuntimeVolume(projectName);
  const sourceDir = path.dirname(agentArtifactPath);

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
      `/src/${HELLO_AGENT_ENTRYPOINT}`,
      `/dest/${HELLO_AGENT_ENTRYPOINT}`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new HelloDeployError(
      `Failed to copy Hello Agent into Compose volume '${volumeName}'.`,
    );
  }

  const integrity = await sha256IntegrityOfVolumeEntrypoint(
    volumeName,
    HELLO_AGENT_ENTRYPOINT,
  );
  const sourceIntegrity = await sha256IntegrityOfFile(agentArtifactPath);
  if (integrity !== sourceIntegrity) {
    throw new HelloDeployError(
      `Installed entrypoint digest (${integrity}) does not match compiled executable (${sourceIntegrity}). The worker would reject execution.`,
    );
  }

  return {
    entrypoint: HELLO_AGENT_ENTRYPOINT,
    integrity,
    deployTarget: `docker-volume:${volumeName}/${HELLO_AGENT_ENTRYPOINT}`,
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
    throw new HelloDeployError(
      `Trusted runtime entrypoint '${entrypoint}' is missing or unreadable in volume '${volumeName}' after install.`,
    );
  }
  return sha256IntegrityOf(result.stdout);
}
