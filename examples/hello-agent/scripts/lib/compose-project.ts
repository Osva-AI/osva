import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { HelloDeployError } from "./errors.js";

/** Declared volume key in `deploy/compose/compose.yml` (not the Docker volume name). */
export const COMPOSE_TRUSTED_RUNTIME_VOLUME_KEY = "osva-trusted-runtime";

export function resolveComposeProjectName(input: {
  readonly osvaComposeProject?: string;
  readonly composeProjectNameEnv?: string;
  readonly composeFileNameField?: string;
}): string {
  const explicit = input.osvaComposeProject?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  const fromEnv = input.composeProjectNameEnv?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  const fromFile = input.composeFileNameField?.trim();
  if (fromFile !== undefined && fromFile.length > 0) {
    return fromFile;
  }
  return "osva-self-hosted";
}

export async function readComposeProjectNameFromFile(
  composeDir: string,
): Promise<string | undefined> {
  const composeFile = path.join(composeDir, "compose.yml");
  const content = await readFile(composeFile, "utf8");
  return parseComposeProjectNameField(content);
}

export function parseComposeProjectNameField(
  composeYaml: string,
): string | undefined {
  const match = composeYaml.match(/^name:\s*([^\s#]+)/m);
  return match?.[1]?.trim();
}

export function resolveComposeTrustedRuntimeVolume(
  projectName: string,
): string {
  assertDockerAvailableForVolumeLookup();

  const result = spawnSync(
    "docker",
    [
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
      "--filter",
      `label=com.docker.compose.volume=${COMPOSE_TRUSTED_RUNTIME_VOLUME_KEY}`,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );

  if (result.status !== 0) {
    throw new HelloDeployError(
      `Failed to list Compose trusted-runtime volumes for project '${projectName}'. ${String(result.stderr).trim()}`,
    );
  }

  const volumes = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (volumes.length === 0) {
    throw new HelloDeployError(
      `No trusted-runtime Compose volume found for project '${projectName}'. Start deploy/compose (worker service) so volume '${COMPOSE_TRUSTED_RUNTIME_VOLUME_KEY}' exists. Set OSVA_COMPOSE_PROJECT or COMPOSE_PROJECT_NAME if you use a non-default project name.`,
    );
  }

  if (volumes.length > 1) {
    throw new HelloDeployError(
      `Multiple trusted-runtime volumes match project '${projectName}': ${volumes.join(", ")}. Resolve the ambiguity before deploying the Hello Agent.`,
    );
  }

  return volumes[0]!;
}

function assertDockerAvailableForVolumeLookup(): void {
  const result = spawnSync("docker", ["version"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new HelloDeployError(
      "Docker is required to resolve the Compose trusted-runtime volume.",
    );
  }
}
