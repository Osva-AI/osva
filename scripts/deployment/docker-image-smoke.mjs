#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDocker } from "./docker-cli.mjs";
import {
  SMOKE_NETWORK,
  baseOsvaContainerEnv,
  dockerEnvFlags,
  removeSmokeInfra,
  startSmokeInfra,
} from "./smoke-network.mjs";
import { verifyRuntimeImageContents } from "./verify-runtime-image.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const IMAGE = process.env.OSVA_IMAGE ?? "osva:smoke";
const WEB_CONTAINER = "osva-image-smoke-web";
const WORKER_CONTAINER = "osva-image-smoke-worker";
const WEB_HOST_PORT = Number.parseInt(
  process.env.OSVA_SMOKE_WEB_PORT ?? "13001",
  10,
);

function removeAppContainers() {
  for (const name of [WEB_CONTAINER, WORKER_CONTAINER]) {
    try {
      runDocker(["rm", "-f", name], { stdio: "pipe" });
    } catch {
      // ignore
    }
  }
}

async function waitHttp(url, attempts = 90) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForLog(container, pattern, attempts = 90) {
  for (let i = 0; i < attempts; i += 1) {
    const logs = spawnSync("docker", ["logs", container], { encoding: "utf8" });
    if (logs.stdout.includes(pattern)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Timed out waiting for log pattern ${pattern} in ${container}`,
  );
}

function stopContainerGracefully(name, timeoutSeconds = 20) {
  runDocker(["stop", "-t", String(timeoutSeconds), name]);
}

async function main() {
  removeAppContainers();
  removeSmokeInfra();

  runDocker(["build", "-t", IMAGE, REPO_ROOT]);
  verifyRuntimeImageContents(IMAGE);

  await startSmokeInfra();
  const env = baseOsvaContainerEnv();

  runDocker([
    "run",
    "--rm",
    "--network",
    SMOKE_NETWORK,
    ...dockerEnvFlags({ ...env, OSVA_PROCESS: "migrate" }),
    IMAGE,
  ]);

  runDocker([
    "run",
    "-d",
    "--name",
    WEB_CONTAINER,
    "--network",
    SMOKE_NETWORK,
    "-p",
    `${String(WEB_HOST_PORT)}:3000`,
    ...dockerEnvFlags({ ...env, OSVA_PROCESS: "web" }),
    IMAGE,
  ]);

  await waitHttp(`http://127.0.0.1:${String(WEB_HOST_PORT)}/health`);
  await waitHttp(`http://127.0.0.1:${String(WEB_HOST_PORT)}/ready`);

  runDocker([
    "run",
    "-d",
    "--name",
    WORKER_CONTAINER,
    "--network",
    SMOKE_NETWORK,
    ...dockerEnvFlags({ ...env, OSVA_PROCESS: "worker" }),
    IMAGE,
  ]);

  await waitForLog(WORKER_CONTAINER, '"event":"worker.started"');

  stopContainerGracefully(WEB_CONTAINER);
  removeAppContainers();
  removeSmokeInfra();

  console.log("docker image smoke PASS");
}

main().catch((error) => {
  console.error(error);
  removeAppContainers();
  removeSmokeInfra();
  process.exitCode = 1;
});
