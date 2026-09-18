import { createDockerodeClient } from "./dockerode-client.js";

export async function isDockerEngineAvailable(): Promise<boolean> {
  try {
    await createDockerodeClient().ping();
    return true;
  } catch {
    return false;
  }
}

export async function assertDockerEngineAvailable(): Promise<void> {
  if (!(await isDockerEngineAvailable())) {
    throw new Error(
      "Docker engine is unavailable. Container execution requires a reachable Docker daemon.",
    );
  }
}
