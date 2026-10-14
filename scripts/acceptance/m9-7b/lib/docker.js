import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { ACCEPTANCE_LABEL, ACCEPTANCE_RUN_LABEL } from "./constants.js";

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

export async function listManagedContainers(dockerBin, runId) {
  const { stdout } = await execFileAsync(dockerBin, [
    "ps",
    "-a",
    "--filter",
    `label=${ACCEPTANCE_RUN_LABEL}=${runId}`,
    "--format",
    "{{.ID}}",
  ]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function listForeignManagedContainers(dockerBin, runId) {
  const { stdout } = await execFileAsync(dockerBin, [
    "ps",
    "-a",
    "--filter",
    `label=${ACCEPTANCE_LABEL}=true`,
    "--format",
    '{{.ID}} {{.Label "osva.acceptance.run"}}',
  ]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id, labelRunId] = line.split(/\s+/, 2);
      return { id, labelRunId: labelRunId ?? "" };
    })
    .filter((entry) => entry.labelRunId !== runId);
}

export async function assertContainerRunOwnership(
  dockerBin,
  containerName,
  runId,
) {
  const { stdout } = await execFileAsync(dockerBin, [
    "inspect",
    "--format",
    '{{ index .Config.Labels "osva.acceptance.run" }}',
    containerName,
  ]);
  if (stdout.trim() !== runId) {
    throw new Error(
      `Refusing operation on container ${containerName} (not owned by run ${runId}).`,
    );
  }
}

export async function createAcceptanceNetwork(dockerBin, networkName, runId) {
  try {
    await execFileAsync(dockerBin, [
      "network",
      "create",
      "--label",
      `${ACCEPTANCE_LABEL}=true`,
      "--label",
      `${ACCEPTANCE_RUN_LABEL}=${runId}`,
      "--label",
      "osva.acceptance.role=network",
      networkName,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) {
      throw error;
    }
  }
}

export async function removeAcceptanceNetwork(dockerBin, networkName, runId) {
  await execFileAsync(dockerBin, ["network", "rm", networkName]).catch(
    () => undefined,
  );
  void runId;
}

export async function dockerRunInfra(
  dockerBin,
  {
    runId,
    role,
    name,
    publishHostPort,
    publishFixedHostPort,
    containerPort,
    image,
    networkName,
    preArgs = [],
    commandArgs = [],
  },
) {
  const args = [
    "run",
    "--detach",
    "--name",
    name,
    "--label",
    `${ACCEPTANCE_LABEL}=true`,
    "--label",
    `${ACCEPTANCE_RUN_LABEL}=${runId}`,
    "--label",
    `osva.acceptance.role=${role}`,
  ];
  if (networkName) {
    args.push("--network", networkName);
  }
  if (publishHostPort) {
    if (publishFixedHostPort !== undefined) {
      args.push(
        "--publish",
        `127.0.0.1:${String(publishFixedHostPort)}:${String(containerPort)}`,
      );
    } else {
      args.push("--publish", `127.0.0.1::${String(containerPort)}`);
    }
  }
  args.push(...preArgs, image, ...commandArgs);
  await execFileAsync(dockerBin, args);
  if (!publishHostPort) {
    return undefined;
  }
  const hostPort =
    publishFixedHostPort !== undefined
      ? String(publishFixedHostPort)
      : await waitForPublishedPort(dockerBin, name, containerPort);
  return hostPort;
}

export async function removeContainer(dockerBin, containerName, runId) {
  await assertContainerRunOwnership(dockerBin, containerName, runId);
  await execFileAsync(dockerBin, ["rm", "-f", containerName]).catch(
    () => undefined,
  );
}

export async function stopContainer(dockerBin, containerName, runId) {
  await assertContainerRunOwnership(dockerBin, containerName, runId);
  await execFileAsync(dockerBin, ["stop", "-t", "5", containerName]).catch(
    () => undefined,
  );
}

export async function startContainer(dockerBin, containerName, runId) {
  await assertContainerRunOwnership(dockerBin, containerName, runId);
  try {
    await execFileAsync(dockerBin, ["start", containerName]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already/i.test(message)) {
      throw error;
    }
  }
}

export async function restartContainer(dockerBin, containerName, runId) {
  await assertContainerRunOwnership(dockerBin, containerName, runId);
  await execFileAsync(dockerBin, ["restart", "-t", "5", containerName]);
}

export async function pauseContainer(dockerBin, containerName, runId) {
  await assertContainerRunOwnership(dockerBin, containerName, runId);
  await execFileAsync(dockerBin, ["pause", containerName]);
}

export async function unpauseContainer(dockerBin, containerName, runId) {
  await assertContainerRunOwnership(dockerBin, containerName, runId);
  await execFileAsync(dockerBin, ["unpause", containerName]);
}

export async function execInContainer(dockerBin, containerName, runId, cmd) {
  await assertContainerRunOwnership(dockerBin, containerName, runId);
  const { stdout } = await execFileAsync(dockerBin, [
    "exec",
    containerName,
    ...cmd,
  ]);
  return stdout;
}

export function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
    shell: options.shell ?? false,
  });
  return child;
}

export async function resolvePublishedHostPort(
  dockerBin,
  containerName,
  containerPort,
) {
  return waitForPublishedPort(dockerBin, containerName, containerPort);
}

async function waitForPublishedPort(dockerBin, containerName, containerPort) {
  const portSpec = `${String(containerPort)}/tcp`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(dockerBin, [
        "port",
        containerName,
        portSpec,
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

export async function snapshotDockerState(dockerBin) {
  const { stdout: containerStdout } = await execFileAsync(dockerBin, [
    "ps",
    "-a",
    "--format",
    "{{.ID}}\t{{.Names}}\t{{.Status}}",
  ]);
  const containers = containerStdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id, name, ...statusParts] = line.split("\t");
      return {
        id: id ?? "",
        name: name ?? "",
        status: statusParts.join("\t"),
      };
    });

  const { stdout: volumeStdout } = await execFileAsync(dockerBin, [
    "volume",
    "ls",
    "--format",
    "{{.Name}}",
  ]);
  const volumes = volumeStdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const { stdout: networkStdout } = await execFileAsync(dockerBin, [
    "network",
    "ls",
    "--format",
    "{{.ID}}\t{{.Name}}",
  ]);
  const networks = networkStdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id, name] = line.split("\t");
      return { id: id ?? "", name: name ?? "" };
    });

  return {
    capturedAt: new Date().toISOString(),
    containers,
    volumes,
    networks,
  };
}

export function findUnauthorizedContainerRemovals(before, after, runId) {
  const afterIds = new Set(after.containers.map((entry) => entry.id));
  const shortId = runId.replaceAll("-", "").slice(0, 12);
  const ownedNameFragment = `osva-m97b-${shortId}`;
  return before.containers.filter((entry) => {
    if (afterIds.has(entry.id)) {
      return false;
    }
    return !entry.name.includes(ownedNameFragment);
  });
}
