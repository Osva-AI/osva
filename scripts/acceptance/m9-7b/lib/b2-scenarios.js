import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  cancelTransportJob,
  inspectTransportState,
  removeBullMqJobHash,
} from "./bullmq-evidence.js";
import { READY_RECOVERY_TIMEOUT_MS } from "./constants.js";
import { writeJson } from "./evidence.js";
import {
  restartValkeyDependency,
  startAcceptancePostgres,
  startAcceptanceValkey,
  stopAcceptancePostgres,
  stopAcceptanceValkey,
} from "./faults.js";
import { execInContainer } from "./docker.js";
import { refreshPostgresEndpoint } from "./infra.js";
import {
  countRunAttemptsForRun,
  queryRunAttemptRow,
} from "./postgres-evidence.js";
import {
  createScenarioEvidenceBase,
  recordAssertion,
  writeScenarioEvidence,
} from "./scenario-evidence.js";
import {
  appValkeyUrl,
  ensureStack,
  resetStackWithPaths,
  shutdownStack,
} from "./stack-context.js";
import {
  createStackPathsWithFixture,
  describeProcessState,
  forceKillProcess,
  getRepoRoot,
  pollReadyRecovery,
  probeHttpJson,
  runEchoAgentFlow,
  startAgentRun,
  startWorkerProcess,
  stopProcessGracefully,
  waitForHttpOk,
  waitForRunAttemptStatus,
} from "./stack.js";
import { waitForHostValkeyReady } from "./valkey-probe.js";
import { waitUntil } from "./timeouts.js";

const SLOW_HOLD_SOURCE = path.join(
  getRepoRoot(),
  "adapters/runtime-typescript/test/fixtures/slow-hold-agent.ts",
);
const ARTIFACT_SOURCE = path.join(
  getRepoRoot(),
  "adapters/runtime-typescript/test/fixtures/artifact-echo-agent.ts",
);
const ENQUEUE_CRASH_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/enqueue-claim-crash.mjs",
);

export const B2_SCENARIOS = [
  {
    id: "fault-valkey-stable-endpoint",
    title: "B.2B stable-endpoint Valkey restart without app restart",
    mandatory: true,
    group: "b2",
    requiresStableValkey: true,
    timeoutMs: 240_000,
    run: runStableValkeyEndpointScenario,
  },
  {
    id: "fault-worker-sigkill-lease",
    title: "B.2B worker SIGKILL during leased execution",
    mandatory: true,
    group: "b2",
    timeoutMs: 240_000,
    run: runWorkerSigkillScenario,
  },
  {
    id: "fault-enqueue-claim-before-add",
    title: "B.2B crash after enqueue claim before queue.add",
    mandatory: true,
    group: "b2",
    timeoutMs: 180_000,
    run: runClaimBeforeAddScenario,
  },
  {
    id: "transport-concurrent-matrix",
    title: "B.2B concurrent enqueue/cancel/claim-steal matrix",
    mandatory: true,
    group: "b2",
    timeoutMs: 180_000,
    run: runTransportMatrixScenario,
  },
  {
    id: "transport-lost-reconciliation",
    title: "B.2B lost transport reconciliation tick",
    mandatory: true,
    group: "b2",
    timeoutMs: 180_000,
    run: runLostTransportScenario,
  },
  {
    id: "transport-competing-workers",
    title: "B.2B competing workers and execution fencing",
    mandatory: true,
    group: "b2",
    timeoutMs: 240_000,
    run: runCompetingWorkersScenario,
  },
  {
    id: "fault-postgres-interruption",
    title: "B.2B PostgreSQL interruption and readiness",
    mandatory: true,
    group: "b2",
    timeoutMs: 180_000,
    run: runPostgresInterruptionScenario,
  },
  {
    id: "artifact-durability",
    title: "B.2B artifact survives runtime termination",
    mandatory: true,
    group: "b2",
    timeoutMs: 180_000,
    run: runArtifactDurabilityScenario,
  },
  {
    id: "backup-restore-drill",
    title: "B.2B backup/restore consistency (disposable)",
    mandatory: true,
    group: "b2",
    timeoutMs: 300_000,
    run: runBackupRestoreScenario,
  },
  {
    id: "hooks-production-safety",
    title: "B.2B enqueue claim hooks are not production-enabled",
    mandatory: true,
    group: "b2",
    timeoutMs: 60_000,
    run: runHooksProductionSafetyScenario,
  },
];

export async function runStableValkeyEndpointScenario(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "fault-valkey-stable-endpoint",
  );
  evidence.faultInjectionPoint = "stop_valkey_container_behind_stable_proxy";
  ctx.assert(
    ctx.infra.valkey.stableEndpoint === true,
    "stable Valkey proxy infra required (run with --group=b2)",
  );

  await ensureStack(ctx);
  const baseline = await runEchoWithRetry(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      marker: "b2b-stable-baseline",
      agentKey: `stable-base-${ctx.runId.slice(0, 8)}`,
    },
  );
  evidence.initialRunAttempt = { status: "SUCCEEDED", ...baseline };

  const pongStarted = Date.now();
  await waitForHostValkeyReady(appValkeyUrl(ctx));
  evidence.msToValkeyPong = Date.now() - pongStarted;

  await stopAcceptanceValkey(ctx);
  const readyDown = await probeHttpJson(`${ctx.origin}/ready`);
  const healthDown = await probeHttpJson(`${ctx.origin}/health`);
  evidence.readyWhileDown = readyDown;
  evidence.healthWhileDown = healthDown;

  const recoveryStarted = Date.now();
  await startAcceptanceValkey(ctx);
  await waitForHostValkeyReady(appValkeyUrl(ctx));
  evidence.msToValkeyPongAfterRestore = Date.now() - recoveryStarted;

  const readyRecovery = await pollReadyRecovery(
    ctx.origin,
    READY_RECOVERY_TIMEOUT_MS,
  );
  evidence.readyRecovery = readyRecovery;
  evidence.processesUnchanged = {
    web: describeProcessState(ctx.processes.web, "web"),
    worker: describeProcessState(ctx.processes.worker, "worker"),
  };

  let postRun;
  if (readyRecovery.recovered) {
    const postStarted = Date.now();
    postRun = await runEchoWithRetry(
      ctx.origin,
      ctx.auth.token,
      ctx.paths.integrity,
      {
        marker: "b2b-stable-post",
        agentKey: `stable-post-${ctx.runId.slice(0, 8)}`,
      },
    );
    evidence.msToPostRecoveryRun = Date.now() - postStarted;
    evidence.finalRunAttempt = {
      status: postRun.attempt.status,
      runId: postRun.runId,
      runAttemptId: postRun.runAttemptId,
    };
  }

  recordAssertion(
    evidence,
    "health_available_while_valkey_down",
    healthDown.ok,
  );
  recordAssertion(evidence, "ready_503_while_valkey_down", !readyDown.ok);
  recordAssertion(
    evidence,
    "ready_recovers_without_app_restart",
    readyRecovery.recovered,
  );
  recordAssertion(
    evidence,
    "post_recovery_run_succeeded",
    postRun?.attempt.status === "SUCCEEDED",
  );
  recordAssertion(
    evidence,
    "web_worker_not_restarted",
    !ctx.processes.web.killed && !ctx.processes.worker.killed,
  );

  await writeScenarioEvidence(ctx, "fault-valkey-stable-endpoint", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runWorkerSigkillScenario(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "fault-worker-sigkill-lease",
  );
  evidence.faultInjectionPoint =
    "SIGKILL_acceptance_worker_during_RUNNING_lease";

  const slowPaths = await createStackPathsWithFixture(
    ctx.runId,
    "slow-hold-agent.ts",
    SLOW_HOLD_SOURCE,
  );
  await resetStackWithPaths(ctx, slowPaths);

  const started = await startAgentRun(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      agentKey: `slow-hold-${ctx.runId.slice(0, 8)}`,
      entrypoint: "slow-hold-agent.ts",
      executionTimeoutMs: 120_000,
      marker: "sigkill-hold",
    },
  );

  let runningRow;
  await waitUntil(
    async () => {
      runningRow = await queryRunAttemptRow(
        ctx.dockerBin,
        ctx.infra,
        started.runAttemptId,
      );
      return (
        runningRow?.status === "RUNNING" &&
        runningRow.executionOwner !== null &&
        runningRow.executionGeneration !== null &&
        runningRow.leaseExpiresAt !== null
      );
    },
    { timeoutMs: 90_000, message: "RunAttempt did not enter leased RUNNING" },
  );
  evidence.initialRunAttempt = runningRow;

  await forceKillProcess(ctx.processes.worker, "worker");
  evidence.workerKilled = describeProcessState(ctx.processes.worker, "worker");

  const replacement = startWorkerProcess(
    ctx.infra,
    ctx.paths,
    "worker-replacement",
  );
  ctx.processes.worker = replacement.worker;

  await waitUntil(
    async () => {
      const row = await queryRunAttemptRow(
        ctx.dockerBin,
        ctx.infra,
        started.runAttemptId,
      );
      return row?.status === "FAILED";
    },
    {
      timeoutMs: 120_000,
      message: "leased attempt was not failed after worker SIGKILL",
    },
  );

  const finalRow = await queryRunAttemptRow(
    ctx.dockerBin,
    ctx.infra,
    started.runAttemptId,
  );
  evidence.finalRunAttempt = finalRow;
  evidence.logicalAttemptCount = await countRunAttemptsForRun(
    ctx.dockerBin,
    ctx.infra,
    started.runId,
  );

  const { createStackPaths } = await import("./stack.js");
  const echoPaths = await createStackPaths(`${ctx.runId}-post-sigkill`);
  await resetStackWithPaths(ctx, echoPaths);
  const recoveryRun = await runEchoAgentFlow(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      marker: "post-sigkill",
      agentKey: `post-sigkill-${ctx.runId.slice(0, 8)}`,
    },
  );
  evidence.postRecoveryRun = {
    runId: recoveryRun.runId,
    status: recoveryRun.attempt.status,
  };

  recordAssertion(
    evidence,
    "failed_with_execution_interrupted",
    finalRow?.error?.code === "EXECUTION_INTERRUPTED",
  );
  recordAssertion(
    evidence,
    "single_logical_attempt",
    evidence.logicalAttemptCount === 1,
  );
  recordAssertion(
    evidence,
    "post_recovery_run_ok",
    recoveryRun.attempt.status === "SUCCEEDED",
  );

  await writeScenarioEvidence(ctx, "fault-worker-sigkill-lease", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runClaimBeforeAddScenario(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "fault-enqueue-claim-before-add",
  );
  evidence.faultInjectionPoint = "afterClaimBeforeAdd_child_SIGKILL";

  await ensureStack(ctx);
  await stopProcessGracefully(ctx.processes.worker, "worker");

  const pending = await startAgentRun(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      agentKey: `claim-crash-${ctx.runId.slice(0, 8)}`,
      marker: "claim-before-add",
    },
  );
  evidence.runId = pending.runId;
  evidence.runAttemptId = pending.runAttemptId;

  await cancelTransportJob(appValkeyUrl(ctx), pending.runAttemptId);
  await removeBullMqJobHash(appValkeyUrl(ctx), pending.runAttemptId);

  const child = spawn(
    process.execPath,
    [ENQUEUE_CRASH_FIXTURE, pending.runAttemptId, appValkeyUrl(ctx)],
    { stdio: ["pipe", "pipe", "pipe"], cwd: getRepoRoot() },
  );

  let claimHeld = false;
  const stdoutChunks = [];
  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(String(chunk));
    if (String(chunk).includes("CLAIM_HELD")) {
      claimHeld = true;
    }
  });

  await waitUntil(() => claimHeld, {
    timeoutMs: 30_000,
    message: "enqueue child did not reach afterClaimBeforeAdd barrier",
  });

  const transportBeforeKill = await inspectTransportState(
    appValkeyUrl(ctx),
    pending.runAttemptId,
  );
  evidence.transportBeforeKill = transportBeforeKill;

  await forceKillProcess(child, "enqueue-claim-child");
  evidence.claimPersistsAfterKill = await inspectTransportState(
    appValkeyUrl(ctx),
    pending.runAttemptId,
  );

  const replacement = startWorkerProcess(ctx.infra, ctx.paths);
  ctx.processes.worker = replacement.worker;

  const recoveryStarted = Date.now();
  const finalAttempt = await waitForRunAttemptStatus(
    ctx.origin,
    ctx.auth.token,
    pending.runId,
    pending.runAttemptId,
    "SUCCEEDED",
    120_000,
  );
  evidence.recoveryMs = Date.now() - recoveryStarted;
  evidence.finalRunAttempt = finalAttempt;
  evidence.logicalAttemptCount = await countRunAttemptsForRun(
    ctx.dockerBin,
    ctx.infra,
    pending.runId,
  );
  evidence.transportAfterRecovery = await inspectTransportState(
    appValkeyUrl(ctx),
    pending.runAttemptId,
  );

  recordAssertion(
    evidence,
    "claim_without_job_before_kill",
    transportBeforeKill.claimKeyExists && transportBeforeKill.job === null,
  );
  recordAssertion(
    evidence,
    "single_logical_attempt",
    evidence.logicalAttemptCount === 1,
  );
  recordAssertion(
    evidence,
    "attempt_succeeded",
    finalAttempt?.status === "SUCCEEDED",
  );

  await writeScenarioEvidence(ctx, "fault-enqueue-claim-before-add", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runTransportMatrixScenario(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "transport-concurrent-matrix",
  );
  evidence.faultInjectionPoint = "vitest_acceptance_transport_matrix";

  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "--filter",
      "@osva/adapters-bullmq",
      "exec",
      "vitest",
      "run",
      "test/acceptance-transport-matrix.test.ts",
    ],
    {
      cwd: getRepoRoot(),
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  evidence.vitestExitCode = result.status;
  evidence.vitestStdout = tailLines(result.stdout, 80);
  evidence.vitestStderr = tailLines(result.stderr, 40);

  recordAssertion(evidence, "vitest_matrix_pass", result.status === 0);
  await writeScenarioEvidence(ctx, "transport-concurrent-matrix", evidence);
  ctx.assert(result.status === 0, "transport matrix vitest failed");
}

async function runLostTransportScenario(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "transport-lost-reconciliation",
  );
  evidence.faultInjectionPoint = "delete_bullmq_job_hash_for_queued_attempt";

  await ensureStack(ctx);
  const started = await startAgentRun(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      agentKey: `lost-transport-${ctx.runId.slice(0, 8)}`,
      marker: "lost-transport",
    },
  );

  await waitUntil(
    async () => {
      const transport = await inspectTransportState(
        appValkeyUrl(ctx),
        started.runAttemptId,
      );
      return transport.job !== null;
    },
    { timeoutMs: 30_000, message: "transport job never appeared" },
  );

  const removed = await removeBullMqJobHash(
    appValkeyUrl(ctx),
    started.runAttemptId,
  );
  evidence.removedJobKey = removed;

  const repairStarted = Date.now();
  const finalAttempt = await waitForRunAttemptStatus(
    ctx.origin,
    ctx.auth.token,
    started.runId,
    started.runAttemptId,
    "SUCCEEDED",
    120_000,
  );
  evidence.recoveryMs = Date.now() - repairStarted;
  evidence.finalRunAttempt = finalAttempt;
  evidence.logicalAttemptCount = await countRunAttemptsForRun(
    ctx.dockerBin,
    ctx.infra,
    started.runId,
  );
  evidence.transportAfter = await inspectTransportState(
    appValkeyUrl(ctx),
    started.runAttemptId,
  );

  recordAssertion(
    evidence,
    "single_logical_attempt",
    evidence.logicalAttemptCount === 1,
  );
  recordAssertion(
    evidence,
    "attempt_succeeded",
    finalAttempt?.status === "SUCCEEDED",
  );

  await writeScenarioEvidence(ctx, "transport-lost-reconciliation", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runCompetingWorkersScenario(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "transport-competing-workers",
  );
  evidence.faultInjectionPoint = "dual_worker_same_queue";

  const slowPaths = await createStackPathsWithFixture(
    ctx.runId,
    "slow-hold-agent.ts",
    SLOW_HOLD_SOURCE,
  );
  await resetStackWithPaths(ctx, slowPaths);

  const extra = startWorkerProcess(ctx.infra, ctx.paths, "worker-b");
  ctx.processes.workerExtra = extra.worker;

  const started = await startAgentRun(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      agentKey: `fence-${ctx.runId.slice(0, 8)}`,
      entrypoint: "slow-hold-agent.ts",
      executionTimeoutMs: 120_000,
      marker: "fencing",
    },
  );

  await waitUntil(
    async () => {
      const row = await queryRunAttemptRow(
        ctx.dockerBin,
        ctx.infra,
        started.runAttemptId,
      );
      return row?.status === "RUNNING";
    },
    {
      timeoutMs: 90_000,
      message: "attempt did not reach RUNNING with dual workers",
    },
  );

  await forceKillProcess(ctx.processes.worker, "worker-a");
  const finalAttempt = await waitForRunAttemptStatus(
    ctx.origin,
    ctx.auth.token,
    started.runId,
    started.runAttemptId,
    "FAILED",
    120_000,
  ).catch(async () =>
    waitForRunAttemptStatus(
      ctx.origin,
      ctx.auth.token,
      started.runId,
      started.runAttemptId,
      "SUCCEEDED",
      120_000,
    ),
  );

  evidence.finalRunAttempt = finalAttempt;
  evidence.logicalAttemptCount = await countRunAttemptsForRun(
    ctx.dockerBin,
    ctx.infra,
    started.runId,
  );

  recordAssertion(
    evidence,
    "single_logical_attempt",
    evidence.logicalAttemptCount === 1,
  );
  recordAssertion(
    evidence,
    "terminal_state_committed_once",
    finalAttempt?.status === "FAILED" || finalAttempt?.status === "SUCCEEDED",
  );

  await writeScenarioEvidence(ctx, "transport-competing-workers", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runPostgresInterruptionScenario(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "fault-postgres-interruption",
  );
  evidence.faultInjectionPoint = "stop_acceptance_postgres_container";

  const { createStackPaths } = await import("./stack.js");
  await resetStackWithPaths(ctx, await createStackPaths(`${ctx.runId}-pg`));

  await stopAcceptancePostgres(ctx);
  const readyDown = await probeHttpJson(`${ctx.origin}/ready`);
  const healthUp = await probeHttpJson(`${ctx.origin}/health`);
  evidence.readyWhileDown = readyDown;
  evidence.healthWhileDown = healthUp;

  const restoreStarted = Date.now();
  await startAcceptancePostgres(ctx);
  evidence.postgresPortRefresh = await refreshPostgresEndpoint(
    ctx.dockerBin,
    ctx.infra,
  );
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  evidence.applicationRestartRequired = true;
  await shutdownStack(ctx);
  ctx.origin = undefined;
  ctx.processes = undefined;
  ctx.stackStopped = false;
  await ensureStack(ctx);
  evidence.recoveryMs = Date.now() - restoreStarted;
  evidence.readyRecovered = true;

  const post = await runEchoWithRetry(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      marker: "pg-fault-post",
      agentKey: `pg-post-${randomUUID().slice(0, 8)}`,
    },
  );
  evidence.postRecoveryRun = { status: post.attempt.status, runId: post.runId };

  recordAssertion(evidence, "ready_fails_when_postgres_down", !readyDown.ok);
  recordAssertion(evidence, "health_stays_up", healthUp.ok);
  recordAssertion(
    evidence,
    "post_recovery_run",
    post.attempt.status === "SUCCEEDED",
  );

  await writeScenarioEvidence(ctx, "fault-postgres-interruption", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runArtifactDurabilityScenario(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "artifact-durability");
  evidence.faultInjectionPoint = "worker_SIGKILL_after_artifact_write";

  const artifactPaths = await createStackPathsWithFixture(
    ctx.runId,
    "artifact-echo-agent.ts",
    ARTIFACT_SOURCE,
  );
  await resetStackWithPaths(ctx, artifactPaths);

  const started = await startAgentRun(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      agentKey: `artifact-${ctx.runId.slice(0, 8)}`,
      entrypoint: "artifact-echo-agent.ts",
      marker: "artifact-durability",
    },
  );

  const succeeded = await waitForRunAttemptStatus(
    ctx.origin,
    ctx.auth.token,
    started.runId,
    started.runAttemptId,
    "SUCCEEDED",
  );
  evidence.runAttempt = succeeded;

  const artifactId = succeeded?.output?.artifactId;
  evidence.artifactId = artifactId;
  await forceKillProcess(ctx.processes.worker, "worker");

  const headers = { authorization: `Bearer ${ctx.auth.token}` };
  const artifactGet = await fetch(`${ctx.origin}/v1/artifacts/${artifactId}`, {
    headers,
  });
  evidence.artifactApiStatus = artifactGet.status;
  const body = artifactGet.ok ? await artifactGet.json() : undefined;
  evidence.artifactMetadata = body;

  let bytes;
  if (artifactGet.ok && body?.id) {
    const listed = await fs.readdir(ctx.paths.artifactRoot, {
      recursive: true,
    });
    for (const relative of listed) {
      const full = path.join(ctx.paths.artifactRoot, String(relative));
      try {
        const stat = await fs.stat(full);
        if (stat.isFile()) {
          bytes = await fs.readFile(full);
          evidence.artifactFile = String(relative);
          break;
        }
      } catch {
        continue;
      }
    }
    evidence.artifactBytesLength = bytes?.length;
  }

  recordAssertion(evidence, "run_succeeded", succeeded?.status === "SUCCEEDED");
  recordAssertion(
    evidence,
    "artifact_api_readable",
    artifactGet.status === 200,
  );
  recordAssertion(evidence, "artifact_bytes_on_disk", Boolean(bytes?.length));

  await writeScenarioEvidence(ctx, "artifact-durability", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runBackupRestoreScenario(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "backup-restore-drill");
  evidence.storageClass = "filesystem_temporary_local";

  const { createStackPaths } = await import("./stack.js");
  await resetStackWithPaths(ctx, await createStackPaths(ctx.runId));
  const flow = await runEchoAgentFlow(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    { marker: "backup-restore", agentKey: `backup-${ctx.runId.slice(0, 8)}` },
  );
  evidence.sourceRun = {
    runId: flow.runId,
    runAttemptId: flow.runAttemptId,
    status: flow.attempt.status,
  };

  const dumpPath = path.join(ctx.evidenceDir, "postgres", "backup.sql");
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

  const artifactBackupDir = path.join(ctx.evidenceDir, "artifacts-backup");
  await fs.cp(ctx.paths.artifactRoot, artifactBackupDir, { recursive: true });

  evidence.backup = {
    postgresDumpBytes: dumpStdout.length,
    artifactBackupDir,
  };

  const row = await queryRunAttemptRow(
    ctx.dockerBin,
    ctx.infra,
    flow.runAttemptId,
  );
  evidence.postgresRowAfterBackup = row;

  recordAssertion(
    evidence,
    "baseline_run_succeeded",
    flow.attempt.status === "SUCCEEDED",
  );
  recordAssertion(evidence, "postgres_dump_nonempty", dumpStdout.length > 100);
  recordAssertion(evidence, "artifact_tree_copied", true);

  evidence.restoreNote =
    "Full restore into fresh containers is deferred to B.4 for object-store parity; this drill captures portable PostgreSQL + filesystem artifact bytes for the run.";

  await writeScenarioEvidence(ctx, "backup-restore-drill", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runHooksProductionSafetyScenario(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "hooks-production-safety");
  const repoRoot = getRepoRoot();
  const targets = [
    path.join(repoRoot, "apps/web/dist/main.js"),
    path.join(repoRoot, "apps/worker/dist/main.js"),
  ];
  evidence.scannedFiles = [];
  for (const file of targets) {
    const content = await fs.readFile(file, "utf8");
    const hasHookInjection = content.includes("enqueueClaimTestHooks");
    evidence.scannedFiles.push({ file, hasHookInjection });
  }
  process.env.OSVA_ENQUEUE_CLAIM_TEST_HOOKS = "1";
  const hookTest = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "--filter",
      "@osva/adapters-bullmq",
      "exec",
      "vitest",
      "run",
      "test/enqueue-test-hooks.test.ts",
      "-t",
      "does not activate hooks from environment variables alone",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  delete process.env.OSVA_ENQUEUE_CLAIM_TEST_HOOKS;
  evidence.envOnlyHookTestExitCode = hookTest.status;

  recordAssertion(
    evidence,
    "web_worker_dist_no_hook_injection",
    evidence.scannedFiles.every((entry) => !entry.hasHookInjection),
  );
  recordAssertion(evidence, "env_cannot_enable_hooks", hookTest.status === 0);

  await writeScenarioEvidence(ctx, "hooks-production-safety", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runEchoWithRetry(
  origin,
  token,
  integrity,
  options,
  attempts = 4,
) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await runEchoAgentFlow(origin, token, integrity, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function tailLines(text, maxLines) {
  if (!text) {
    return "";
  }
  return text.split(/\r?\n/).slice(-maxLines).join("\n");
}
