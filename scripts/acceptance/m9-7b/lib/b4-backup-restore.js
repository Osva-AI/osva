import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { POSTGRES_IMAGE, VALKEY_IMAGE } from "./constants.js";
import { dockerRunInfra, execInContainer, removeContainer } from "./docker.js";
import { queryPostgresStatus } from "./infra.js";
import { getRepoRoot, runEchoAgentFlow, waitForHttpOk } from "./stack.js";
import {
  createStackPathsWithFixture,
  startWebWorkerProcesses,
  stopProcessGracefully,
} from "./stack.js";
import { waitUntil, withTimeout } from "./timeouts.js";

const execFileAsync = promisify(execFile);

export async function startIsolatedRestoreTargets(dockerBin, runId) {
  const shortId = runId.replaceAll("-", "").slice(0, 12);
  const pgName = `osva-m97b-${shortId}-pg-restore`;
  const valkeyName = `osva-m97b-${shortId}-valkey-restore`;
  const pgPort = await dockerRunInfra(dockerBin, {
    runId,
    role: "postgres-restore",
    name: pgName,
    publishHostPort: true,
    containerPort: 5432,
    image: POSTGRES_IMAGE,
    preArgs: [
      "--env",
      "POSTGRES_USER=osva",
      "--env",
      "POSTGRES_PASSWORD=osva_acceptance",
      "--env",
      "POSTGRES_DB=osva_acceptance",
    ],
  });
  const valkeyPort = await dockerRunInfra(dockerBin, {
    runId,
    role: "valkey-restore",
    name: valkeyName,
    publishHostPort: true,
    containerPort: 6379,
    image: VALKEY_IMAGE,
    commandArgs: ["valkey-server", "--appendonly", "yes"],
  });
  const connectionString = `postgres://osva:osva_acceptance@127.0.0.1:${pgPort}/osva_acceptance`;
  const valkeyUrl = `redis://127.0.0.1:${valkeyPort}`;
  return {
    runId,
    postgres: {
      containerName: pgName,
      hostPort: pgPort,
      connectionString,
    },
    valkey: {
      containerName: valkeyName,
      hostPort: valkeyPort,
      url: valkeyUrl,
    },
  };
}

export async function stopIsolatedRestoreTargets(dockerBin, runId, targets) {
  if (!targets) {
    return;
  }
  await removeContainer(dockerBin, targets.valkey.containerName, runId);
  await removeContainer(dockerBin, targets.postgres.containerName, runId);
}

async function uploadTestArtifact(origin, token) {
  const payload = Buffer.from(`b4-restore-payload-${Date.now()}`);
  const form = new FormData();
  form.set("name", "b4-restore.bin");
  form.append("file", new Blob([payload]), "b4-restore.bin");
  const created = await fetch(`${origin}/v1/artifacts`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (created.status !== 201) {
    throw new Error(`Artifact upload failed: ${created.status}`);
  }
  const body = await created.json();
  const checksum = createHash("sha256").update(payload).digest("hex");
  return { artifactId: body.id, digest: body.digest, payload, checksum };
}

export async function runIndependentBackupRestoreDrill(ctx) {
  const { resetStackWithPaths } = await import("./stack-context.js");
  const { runEchoAgentFlow } = await import("./stack.js");

  const paths = await createStackPathsWithFixture(
    ctx.runId,
    "echo-input-agent.ts",
    path.join(
      getRepoRoot(),
      "adapters/runtime-typescript/test/fixtures/echo-input-agent.ts",
    ),
  );
  await resetStackWithPaths(ctx, paths);

  const flow = await runEchoAgentFlow(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      agentKey: `restore-${ctx.runId.slice(0, 8)}`,
      marker: "b4-restore-source",
    },
  );
  ctx.assert(flow.attempt.status === "SUCCEEDED", "source run succeeded");

  const artifact = await uploadTestArtifact(ctx.origin, ctx.auth.token);
  const artifactId = artifact.artifactId;
  const sourceChecksum = artifact.checksum;

  const artifactResponse = await fetch(
    `${ctx.origin}/v1/artifacts/${artifactId}`,
    { headers: { authorization: `Bearer ${ctx.auth.token}` } },
  );
  ctx.assert(
    artifactResponse.status === 200,
    "artifact metadata before backup",
  );
  const artifactMeta = await artifactResponse.json();

  const dumpPath = path.join(
    ctx.evidenceDir,
    "postgres",
    "b4-restore-source.sql",
  );
  await fs.mkdir(path.dirname(dumpPath), { recursive: true });
  const dumpStdout = await execInContainer(
    ctx.dockerBin,
    ctx.infra.postgres.containerName,
    ctx.runId,
    [
      "pg_dump",
      "-U",
      "osva",
      "-d",
      "osva_acceptance",
      "--no-owner",
      "--format=plain",
    ],
  );
  await fs.writeFile(dumpPath, dumpStdout, "utf8");

  const artifactBackupDir = path.join(
    ctx.evidenceDir,
    "artifacts-backup",
    "b4-restore",
  );
  await fs.cp(ctx.paths.artifactRoot, artifactBackupDir, { recursive: true });

  const restoreTargets = await startIsolatedRestoreTargets(
    ctx.dockerBin,
    ctx.runId,
  );
  const restoreArtifactRoot = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      `osva-m97b-restore-artifacts-${ctx.runId.slice(0, 8)}-`,
    ),
  );
  await fs.cp(artifactBackupDir, restoreArtifactRoot, { recursive: true });

  await waitForPostgresReady(
    ctx.dockerBin,
    restoreTargets.postgres.containerName,
    ctx.runId,
  );

  const containerDumpPath = "/tmp/osva-b4-restore.sql";
  await execFileAsync(ctx.dockerBin, [
    "cp",
    dumpPath,
    `${restoreTargets.postgres.containerName}:${containerDumpPath}`,
  ]);
  let restoreError = "";
  await waitUntil(
    async () => {
      try {
        await withTimeout(
          execInContainer(
            ctx.dockerBin,
            restoreTargets.postgres.containerName,
            restoreTargets.runId,
            [
              "psql",
              "-v",
              "ON_ERROR_STOP=1",
              "-U",
              "osva",
              "-d",
              "osva_acceptance",
              "-f",
              containerDumpPath,
            ],
          ),
          60_000,
          "psql restore exec",
        );
        return true;
      } catch (error) {
        restoreError = error instanceof Error ? error.message : String(error);
        return false;
      }
    },
    {
      timeoutMs: 180_000,
      message: `postgres restore psql failed: ${restoreError}`,
    },
  );

  const repoRoot = getRepoRoot();
  const integrityOutput = await withTimeout(
    execFileAsync(
      process.execPath,
      [
        path.join(repoRoot, "packages/db/dist/migrations-integrity-cli.js"),
        restoreTargets.postgres.connectionString,
      ],
      { encoding: "utf8" },
    ),
    120_000,
    "restore integrity",
  );
  ctx.assert(
    integrityOutput.stdout.includes("schema integrity: applied_and_matches"),
    "restored schema integrity",
  );

  const restorePaths = {
    artifactRoot: restoreArtifactRoot,
    trustedRuntimeRoot: paths.trustedRuntimeRoot,
    integrity: paths.integrity,
  };
  const restoreInfra = {
    runId: ctx.runId,
    postgres: restoreTargets.postgres,
    valkey: restoreTargets.valkey,
  };
  const webPort = await allocatePort();
  const processes = startWebWorkerProcesses(
    restoreInfra,
    restorePaths,
    String(webPort),
    { OSVA_EXECUTION_RECOVERY_POLL_MS: "500" },
  );
  const restoreOrigin = `http://127.0.0.1:${String(webPort)}`;
  await waitForHttpOk(`${restoreOrigin}/health`);
  await waitForHttpOk(`${restoreOrigin}/ready`);

  const attemptGet = await fetch(
    `${restoreOrigin}/v1/runs/${flow.runId}/attempts/${flow.runAttemptId}`,
    { headers: { authorization: `Bearer ${ctx.auth.token}` } },
  );
  ctx.assert(attemptGet.status === 200, "restored run attempt readable");
  const attemptBody = await attemptGet.json();
  ctx.assert(attemptBody.status === "SUCCEEDED", "restored attempt status");

  const pgStatus = await queryPostgresStatus(
    ctx.dockerBin,
    restoreTargets,
    flow.runAttemptId,
  );
  ctx.assert(pgStatus === "SUCCEEDED", "postgres row status after restore");

  const restoredArtifactGet = await fetch(
    `${restoreOrigin}/v1/artifacts/${artifactId}`,
    { headers: { authorization: `Bearer ${ctx.auth.token}` } },
  );
  ctx.assert(
    restoredArtifactGet.status === 200,
    "artifact metadata after restore",
  );
  const restoredMeta = await restoredArtifactGet.json();
  ctx.assert(
    !JSON.stringify(restoredMeta).includes(ctx.paths.artifactRoot),
    "metadata does not embed source filesystem root",
  );

  const contentGet = await fetch(
    `${restoreOrigin}/v1/artifacts/${artifactId}/content`,
    { headers: { authorization: `Bearer ${ctx.auth.token}` } },
  );
  ctx.assert(contentGet.status === 200, "artifact content via restored API");
  const restoredBytes = Buffer.from(await contentGet.arrayBuffer());
  const restoredChecksum = createHash("sha256")
    .update(restoredBytes)
    .digest("hex");
  ctx.assert(restoredChecksum === sourceChecksum, "artifact checksum match");

  const postRestoreRun = await runEchoAgentFlow(
    restoreOrigin,
    ctx.auth.token,
    restorePaths.integrity,
    {
      marker: "b4-post-restore",
      agentKey: `post-restore-${ctx.runId.slice(0, 8)}`,
    },
  );
  ctx.assert(
    postRestoreRun.attempt.status === "SUCCEEDED",
    "new run after restore",
  );

  await stopProcessGracefully(processes.web, "restore-web");
  await stopProcessGracefully(processes.worker, "restore-worker");
  await stopIsolatedRestoreTargets(ctx.dockerBin, ctx.runId, restoreTargets);

  return {
    sourceRun: {
      runId: flow.runId,
      runAttemptId: flow.runAttemptId,
      artifactId,
    },
    backup: {
      postgresDumpBytes: dumpStdout.length,
      artifactBackupDir,
      sourceChecksum,
      consistencyNote:
        "Point-in-time: PostgreSQL pg_dump and filesystem artifact tree copied sequentially; not a single atomic snapshot across stores.",
    },
    restore: {
      postgresContainer: restoreTargets.postgres.containerName,
      valkeyContainer: restoreTargets.valkey.containerName,
      artifactRoot: restoreArtifactRoot,
      restoredChecksum,
      postRestoreRunId: postRestoreRun.runId,
    },
    artifactMetaBefore: {
      id: artifactMeta.id,
      contentType: artifactMeta.contentType,
    },
    limitations: {
      crossStoreAtomicity:
        "PostgreSQL pg_dump and filesystem artifact backup are sequential; not one atomic snapshot.",
      artifactBackend: "filesystem (OSVA_ARTIFACT_FILESYSTEM_ROOT)",
      s3CompatibleRestore:
        "NOT_PROVEN — independent drill used local filesystem artifact tree only.",
      queueTransport:
        "Fresh Valkey instance; BullMQ queues reconstructed by application reconciliation, not restored from backup.",
      schemaIntegrity:
        "Validated via migrations-integrity-cli on restore target after psql restore.",
      followUp:
        "If production uses S3-compatible object storage, run a separate object-store restore drill before claiming full DR coverage.",
    },
  };
}

async function waitForPostgresReady(dockerBin, containerName, runId) {
  await waitUntil(
    async () => {
      try {
        await execInContainer(dockerBin, containerName, runId, [
          "pg_isready",
          "-U",
          "osva",
          "-d",
          "osva_acceptance",
        ]);
        return true;
      } catch {
        return false;
      }
    },
    { timeoutMs: 60_000, message: "restore postgres not ready" },
  );
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
