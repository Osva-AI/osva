import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { Redis } from "ioredis";

const execFileAsync = promisify(execFile);

function dockerExecOptions(dockerBin: string): { env: NodeJS.ProcessEnv } {
  const dockerBinDir = path.dirname(dockerBin);
  const pathKey =
    process.env.Path !== undefined && process.env.PATH === undefined
      ? "Path"
      : "PATH";
  const currentPath = process.env[pathKey] ?? process.env.PATH ?? "";
  return {
    env: {
      ...process.env,
      [pathKey]: `${dockerBinDir}${path.delimiter}${currentPath}`,
    },
  };
}

async function execDocker(
  dockerBin: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(dockerBin, [...args], dockerExecOptions(dockerBin));
}

const HOST_VALKEY_READY_ATTEMPTS = 40;
const HOST_VALKEY_READY_DELAY_MS = 250;
export const VALKEY_TEST_IMAGE = "valkey/valkey:8.1.10-alpine";

export interface ValkeyTestContext {
  readonly url: string;
  readonly usingDocker: boolean;
  readonly containerName?: string;
  readonly dockerBin?: string;
}

export async function startValkeyForTests(): Promise<ValkeyTestContext> {
  const existingUrl = process.env.OSVA_TEST_VALKEY_URL;
  if (existingUrl) {
    await waitForHostValkeyReady(existingUrl);
    return {
      url: existingUrl,
      usingDocker: false,
    };
  }

  const dockerBin = await findDockerBin();
  if (!dockerBin) {
    throw new Error(
      "A real Valkey instance is required for @osva/adapters-bullmq integration tests. Install Docker Desktop and ensure `docker --version` and `docker info` succeed, or set OSVA_TEST_VALKEY_URL to an isolated Valkey URL.",
    );
  }

  try {
    await assertDockerDaemon(dockerBin);
  } catch {
    throw new Error(
      "Docker is installed but the daemon is not available (`docker info` failed). Start Docker Desktop or set OSVA_TEST_VALKEY_URL to an isolated Valkey URL.",
    );
  }

  return startDockerValkey(dockerBin);
}

export async function stopValkeyForTests(
  context: ValkeyTestContext,
): Promise<void> {
  if (context.usingDocker && context.dockerBin && context.containerName) {
    await removeContainer(context.dockerBin, context.containerName);
  }
}

async function startDockerValkey(
  dockerBin: string,
): Promise<ValkeyTestContext> {
  const containerName = `osva-valkey-itest-${String(process.pid)}-${String(Date.now())}`;
  await execDocker(dockerBin, [
    "run",
    "--detach",
    "--name",
    containerName,
    "--publish",
    "127.0.0.1::6379",
    VALKEY_TEST_IMAGE,
    "valkey-server",
    "--appendonly",
    "yes",
  ]);

  try {
    const hostPort = await waitForPublishedPort(dockerBin, containerName);
    await waitForDockerValkeyReady(dockerBin, containerName);
    const url = `redis://127.0.0.1:${hostPort}`;
    await waitForHostValkeyReady(url);
    return {
      url,
      usingDocker: true,
      containerName,
      dockerBin,
    };
  } catch (error) {
    await removeContainer(dockerBin, containerName);
    throw error;
  }
}

async function findDockerBin(): Promise<string | undefined> {
  const candidates = [
    "docker",
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Docker",
      "Docker",
      "resources",
      "bin",
      "docker.exe",
    ),
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "DockerDesktop",
      "resources",
      "bin",
      "docker.exe",
    ),
    path.join(process.env.USERPROFILE ?? "", ".docker", "bin", "docker.exe"),
  ];

  for (const candidate of candidates) {
    if (candidate !== "docker" && !fs.existsSync(candidate)) {
      continue;
    }

    try {
      await execFileAsync(candidate, ["--version"]);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function assertDockerDaemon(dockerBin: string): Promise<void> {
  await execDocker(dockerBin, ["info"]);
}

async function waitForPublishedPort(
  dockerBin: string,
  containerName: string,
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { stdout } = await execDocker(dockerBin, [
        "port",
        containerName,
        "6379/tcp",
      ]);
      const match = stdout.trim().match(/:(\d+)\s*$/);
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // Container may not have published the port yet.
    }

    await delay(250);
  }

  throw new Error(
    `Timed out waiting for published Valkey port on container '${containerName}'.`,
  );
}

async function waitForDockerValkeyReady(
  dockerBin: string,
  containerName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const { stdout } = await execDocker(dockerBin, [
        "exec",
        containerName,
        "valkey-cli",
        "ping",
      ]);
      if (stdout.trim() === "PONG") {
        return;
      }
    } catch {
      await delay(500);
    }
  }

  throw new Error(
    `Timed out waiting for Valkey to become ready in container '${containerName}'.`,
  );
}

export async function waitForHostValkeyReady(url: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < HOST_VALKEY_READY_ATTEMPTS; attempt += 1) {
    const connection = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    try {
      await connection.connect();
      const response = await connection.ping();
      if (response === "PONG") {
        return;
      }
      lastError = new Error(`Valkey ping returned ${String(response)}.`);
    } catch (error) {
      lastError = error;
    } finally {
      try {
        await connection.quit();
      } catch {
        connection.disconnect();
      }
    }

    await delay(HOST_VALKEY_READY_DELAY_MS);
  }

  const detail =
    lastError instanceof Error && lastError.message.trim().length > 0
      ? lastError.message.trim()
      : "unknown error";
  throw new Error(
    `Timed out waiting for host Valkey after ${String(HOST_VALKEY_READY_ATTEMPTS)} attempts. Last error: ${detail}`,
  );
}

async function removeContainer(
  dockerBin: string,
  containerName: string,
): Promise<void> {
  try {
    await execDocker(dockerBin, ["rm", "-f", containerName]);
  } catch {
    // Best-effort cleanup for a temporary test container.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
