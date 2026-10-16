import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ProjectStateError } from "./errors.js";

export const DEPLOYMENT_STATE_SCHEMA_VERSION = "1" as const;

export interface ProjectDeploymentState {
  readonly schemaVersion: typeof DEPLOYMENT_STATE_SCHEMA_VERSION;
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly agentKey: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly manifestFingerprint: string;
  readonly integrity: string;
  readonly deployTarget: string;
  readonly entrypoint: string;
  readonly updatedAt: string;
  readonly lastRunId?: string;
  readonly lastRunAttemptId?: string;
}

const SECRET_KEY_PATTERN = /api[_-]?key|secret|password|token|authorization/i;

export function deploymentStatePath(projectDir: string): string {
  return path.join(projectDir, ".osva", "deployment.json");
}

export function assertStateHasNoSecrets(state: ProjectDeploymentState): void {
  const serialized = JSON.stringify(state);
  if (SECRET_KEY_PATTERN.test(serialized)) {
    throw new ProjectStateError(
      "Refusing to persist state containing secret-like keys.",
    );
  }
}

export async function readDeploymentState(
  projectDir: string,
): Promise<ProjectDeploymentState | null> {
  try {
    const raw = await readFile(deploymentStatePath(projectDir), "utf8");
    const parsed = JSON.parse(raw) as ProjectDeploymentState;
    if (parsed.schemaVersion !== DEPLOYMENT_STATE_SCHEMA_VERSION) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function writeDeploymentState(
  projectDir: string,
  state: ProjectDeploymentState,
): Promise<void> {
  assertStateHasNoSecrets(state);
  const filePath = deploymentStatePath(projectDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function assertDeploymentContext(input: {
  readonly state: ProjectDeploymentState;
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly manifestFingerprint: string;
  readonly integrity: string;
}): void {
  if (input.state.baseUrl !== input.baseUrl) {
    throw new ProjectStateError(
      "Local deployment state was created for a different OSVA_BASE_URL. Run osva deploy again after pointing at the intended control plane.",
    );
  }
  if (input.state.workspaceId !== input.workspaceId) {
    throw new ProjectStateError(
      "Local deployment state belongs to a different workspace. Run osva deploy with the correct OSVA_API_KEY.",
    );
  }
  if (
    input.state.manifestFingerprint !== input.manifestFingerprint ||
    input.state.integrity !== input.integrity
  ) {
    throw new ProjectStateError(
      "Project manifest or executable changed since the last deploy. Run osva deploy before osva run.",
    );
  }
}
