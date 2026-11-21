import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { ACCEPTANCE_LABEL, ACCEPTANCE_RUN_LABEL } from "../constants.mjs";

const execFileAsync = promisify(execFile);

export async function findDockerBin() {
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

export async function assertDockerReady(dockerBin) {
  await execFileAsync(dockerBin, ["info"]);
}

export async function pullImage(dockerBin, imageRef) {
  await execFileAsync(dockerBin, ["pull", imageRef]);
}

export async function imageDigest(dockerBin, imageRef) {
  const { stdout } = await execFileAsync(dockerBin, [
    "inspect",
    "--format",
    "{{index .RepoDigests 0}}",
    imageRef,
  ]);
  const line = stdout.trim();
  const digest = line.includes("@") ? line.split("@")[1] : undefined;
  return digest;
}

export async function runLitellmProxy(dockerBin, options) {
  const {
    runId,
    containerName,
    image,
    configHostPath,
    masterKey,
    publishHostPort,
  } = options;
  const args = [
    "run",
    "--detach",
    "--name",
    containerName,
    "--label",
    `${ACCEPTANCE_LABEL}=true`,
    "--label",
    `${ACCEPTANCE_RUN_LABEL}=${runId}`,
    "--add-host",
    "host.docker.internal:host-gateway",
    "--publish",
    `127.0.0.1:${String(publishHostPort)}:4000`,
    "-e",
    `LITELLM_MASTER_KEY=${masterKey}`,
    "-v",
    `${configHostPath}:/app/config.yaml:ro`,
    image,
    "--config",
    "/app/config.yaml",
  ];
  await execFileAsync(dockerBin, args);
}

export async function waitForProxyHealth(proxyBaseUrl, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `${proxyBaseUrl.replace(/\/$/, "")}/health/liveliness`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(500);
  }
  throw new Error(`LiteLLM proxy not healthy at ${url}`);
}

export async function removeContainer(dockerBin, containerName) {
  await execFileAsync(dockerBin, ["rm", "-f", containerName]).catch(
    () => undefined,
  );
}

export async function resolvePublishedPort(dockerBin, containerName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(dockerBin, [
        "port",
        containerName,
        "4000/tcp",
      ]);
      const match = stdout.match(/:(\d+)\s*$/m);
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`Timed out resolving published port for ${containerName}`);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function dockerPreflight() {
  return spawnSync("node", ["scripts/verification/docker-preflight.mjs"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
