import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { execFile, spawnSync } from "node:child_process";

import { ACCEPTANCE_LABEL, ACCEPTANCE_RUN_LABEL } from "./constants.js";
import {
  assertContainerRunOwnership,
  removeContainer,
  stopContainer,
} from "./docker.js";
import { getRepoRoot, waitForHttpOk } from "./stack.js";
import { waitUntil } from "./timeouts.js";

const execFileAsync = promisify(execFile);

const ECHO_AGENT_SOURCE = path.join(
  getRepoRoot(),
  "adapters/runtime-typescript/test/fixtures/echo-input-agent.ts",
);

export function acceptanceImageTag(runId) {
  return `osva-m97b-${runId.replaceAll("-", "").slice(0, 12)}:local`;
}

export async function buildAcceptanceDistributionImage(dockerBin, runId) {
  const repoRoot = getRepoRoot();
  const tag = acceptanceImageTag(runId);
  await execFileAsync(
    dockerBin,
    [
      "build",
      "-t",
      tag,
      "--label",
      `${ACCEPTANCE_LABEL}=true`,
      "--label",
      `${ACCEPTANCE_RUN_LABEL}=${runId}`,
      "--label",
      "osva.acceptance.role=distribution-image",
      repoRoot,
    ],
    { stdio: "inherit", maxBuffer: 20 * 1024 * 1024 },
  );
  const inspect = await execFileAsync(dockerBin, [
    "inspect",
    "--format",
    "{{json .Id}} {{json .RepoDigests}}",
    tag,
  ]);
  const [idJson, digestsJson] = inspect.stdout.trim().split(/\s+/, 2);
  return {
    tag,
    imageId: JSON.parse(idJson),
    repoDigests: JSON.parse(digestsJson ?? "[]"),
    buildSha: spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).stdout.trim(),
    provenance: "local-source-built-distribution-image",
  };
}

export async function verifyDistributionImageRuntime(dockerBin, tag) {
  const { verifyRuntimeImageContents } =
    await import("../../../deployment/verify-runtime-image.mjs");
  return verifyRuntimeImageContents(tag);
}

function hostGatewayArgs() {
  return ["--add-host=host.docker.internal:host-gateway"];
}

function dockerHostUrl(hostPort) {
  return `http://host.docker.internal:${String(hostPort)}`;
}

function databaseUrlForContainer(hostPort) {
  return `postgres://osva:osva_acceptance@host.docker.internal:${String(hostPort)}/osva_acceptance`;
}

function valkeyUrlForContainer(hostPort) {
  return `redis://host.docker.internal:${String(hostPort)}`;
}

export async function prepareTrustedRuntimeVolume(dockerBin, tag, runId) {
  const trustedDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `osva-m97b-trusted-vol-${runId.slice(0, 8)}-`),
  );
  await fs.copyFile(
    ECHO_AGENT_SOURCE,
    path.join(trustedDir, "echo-input-agent.ts"),
  );
  const integrityHex = createHash("sha256")
    .update(await fs.readFile(path.join(trustedDir, "echo-input-agent.ts")))
    .digest("hex");
  return {
    trustedDir,
    integrity: `sha256:${integrityHex}`,
  };
}

async function dockerRunAcceptanceApp(dockerBin, runId, args, containerName) {
  await execFileAsync(dockerBin, [
    "run",
    "--detach",
    "--name",
    containerName,
    "--label",
    `${ACCEPTANCE_LABEL}=true`,
    "--label",
    `${ACCEPTANCE_RUN_LABEL}=${runId}`,
    ...args,
  ]);
}

export async function deployImageWebWorkerStack(ctx, imageMeta, options = {}) {
  const { dockerBin, runId, infra } = ctx;
  const tag = imageMeta.tag;
  const shortId = runId.replaceAll("-", "").slice(0, 12);
  const webName = `osva-m97b-${shortId}-img-web`;
  const workerName = `osva-m97b-${shortId}-img-worker`;
  const artifactDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `osva-m97b-artifacts-img-${shortId}-`),
  );
  const { trustedDir, integrity } = await prepareTrustedRuntimeVolume(
    dockerBin,
    tag,
    runId,
  );

  const pgPort = infra.postgres.hostPort;
  const valkeyPort = infra.valkey.hostPort;
  const baseEnv = [
    "-e",
    `OSVA_DATABASE_URL=${databaseUrlForContainer(pgPort)}`,
    "-e",
    `OSVA_VALKEY_URL=${valkeyUrlForContainer(valkeyPort)}`,
    "-e",
    "OSVA_ARTIFACT_STORAGE_DRIVER=filesystem",
    "-e",
    "OSVA_ARTIFACT_FILESYSTEM_ROOT=/var/lib/osva/artifacts",
    "-e",
    "OSVA_TRUSTED_RUNTIME_ROOT=/var/lib/osva/trusted-runtime",
    "-e",
    "OSVA_KNOWLEDGE_EMBEDDING_PROVIDER=DETERMINISTIC",
    "-e",
    "OSVA_KNOWLEDGE_EMBEDDING_MODEL=deterministic-v1",
    "-e",
    "OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS=384",
    "-e",
    "OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS=true",
    "-e",
    "OSVA_CONTAINER_ENABLED=false",
    ...(options.extraEnv ?? []).flatMap(([key, value]) => [
      "-e",
      `${key}=${value}`,
    ]),
  ];

  const volumes = [
    "-v",
    `${artifactDir}:/var/lib/osva/artifacts`,
    "-v",
    `${trustedDir}:/var/lib/osva/trusted-runtime:ro`,
  ];

  await dockerRunAcceptanceApp(
    dockerBin,
    runId,
    [
      ...hostGatewayArgs(),
      ...volumes,
      ...baseEnv,
      "-e",
      "OSVA_PROCESS=migrate",
      tag,
    ],
    `osva-m97b-${shortId}-img-migrate`,
  );
  await waitForContainerExit(
    dockerBin,
    `osva-m97b-${shortId}-img-migrate`,
    runId,
    0,
  );
  await removeContainer(dockerBin, `osva-m97b-${shortId}-img-migrate`, runId);

  const bootstrapName = `osva-m97b-${shortId}-img-bootstrap`;
  await dockerRunAcceptanceApp(
    dockerBin,
    runId,
    [
      ...hostGatewayArgs(),
      ...volumes,
      ...baseEnv,
      "-e",
      "OSVA_PROCESS=bootstrap",
      "-e",
      "OSVA_BOOTSTRAP_WORKSPACE_NAME=Image Acceptance",
      tag,
    ],
    bootstrapName,
  );
  await waitForContainerExit(dockerBin, bootstrapName, runId, 0);
  const bootstrapLogs = await containerLogs(dockerBin, bootstrapName, runId);
  await removeContainer(dockerBin, bootstrapName, runId);
  const tokenMatch = `${bootstrapLogs}`.match(
    /osva_ak_[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+/,
  );
  if (!tokenMatch) {
    throw new Error(
      `Image bootstrap did not emit API key (log tail: ${bootstrapLogs.slice(-500)})`,
    );
  }

  const webPort = await allocatePort();
  await dockerRunAcceptanceApp(
    dockerBin,
    runId,
    [
      ...hostGatewayArgs(),
      ...volumes,
      ...baseEnv,
      "-e",
      "OSVA_PROCESS=web",
      "-e",
      "OSVA_WEB_HOST=0.0.0.0",
      "-e",
      "OSVA_WEB_PORT=3000",
      "-p",
      `127.0.0.1:${String(webPort)}:3000`,
      tag,
    ],
    webName,
  );

  await dockerRunAcceptanceApp(
    dockerBin,
    runId,
    [
      ...hostGatewayArgs(),
      ...volumes,
      ...baseEnv,
      "-e",
      "OSVA_PROCESS=worker",
      "-e",
      "OSVA_EXECUTION_RECOVERY_POLL_MS=500",
      tag,
    ],
    workerName,
  );

  const origin = `http://127.0.0.1:${String(webPort)}`;
  await waitForHttpOk(`${origin}/health`);
  await waitForHttpOk(`${origin}/ready`);

  return {
    origin,
    auth: { token: tokenMatch[0] },
    integrity,
    artifactDir,
    trustedDir,
    webName,
    workerName,
    webPort,
    commands: [
      `docker build -t ${tag} .`,
      `docker run OSVA_PROCESS=migrate`,
      `docker run OSVA_PROCESS=bootstrap`,
      `docker run OSVA_PROCESS=web (port ${webPort})`,
      `docker run OSVA_PROCESS=worker`,
    ],
  };
}

export async function stopImageStack(dockerBin, runId, stack) {
  if (!stack) {
    return;
  }
  for (const name of [stack.webName, stack.workerName]) {
    if (name) {
      await stopContainer(dockerBin, name, runId).catch(() => undefined);
      await removeContainer(dockerBin, name, runId).catch(() => undefined);
    }
  }
}

async function waitForContainerExit(dockerBin, name, runId, expectedCode) {
  await waitUntil(
    async () => {
      try {
        await assertContainerRunOwnership(dockerBin, name, runId);
        const { stdout } = await execFileAsync(dockerBin, [
          "inspect",
          "--format",
          "{{.State.Status}} {{.State.ExitCode}}",
          name,
        ]);
        const [status, code] = stdout.trim().split(/\s+/);
        return status === "exited" && Number(code) === expectedCode;
      } catch {
        return false;
      }
    },
    { timeoutMs: 120_000, message: `container ${name} did not exit cleanly` },
  );
}

async function containerLogs(dockerBin, name, runId) {
  await assertContainerRunOwnership(dockerBin, name, runId);
  const { stdout } = await execFileAsync(dockerBin, ["logs", name]);
  return stdout;
}

async function allocatePort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

export { dockerHostUrl, databaseUrlForContainer, valkeyUrlForContainer };
