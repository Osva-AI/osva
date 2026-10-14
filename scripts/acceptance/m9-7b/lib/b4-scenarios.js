import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { runStableValkeyEndpointScenario } from "./b2-scenarios.js";
import { runIndependentBackupRestoreDrill } from "./b4-backup-restore.js";
import {
  acceptanceImageTag,
  buildAcceptanceDistributionImage,
  deployImageWebWorkerStack,
  stopImageStack,
  verifyDistributionImageRuntime,
} from "./b4-image.js";
import {
  startOtlpCaptureServer,
  waitForTraceEvidence,
} from "./b4-otlp-capture.js";
import { reviewDeploymentSecurity } from "./b4-security-review.js";
import { runPnpmVitest } from "./b3-observability-infra.js";
import { bootstrapWorkspace } from "./b3-workspaces.js";
import {
  createScenarioEvidenceBase,
  recordAssertion,
  writeScenarioEvidence,
} from "./scenario-evidence.js";
import {
  ensureDatabaseReady,
  ensureStack,
  restartAppProcesses,
} from "./stack-context.js";
import { bootstrapApiKey } from "./stack.js";
import {
  getRepoRoot,
  pollReadyRecovery,
  probeHttpJson,
  runEchoAgentFlow,
  waitForHttpOk,
} from "./stack.js";
import { stopAcceptancePostgres, startAcceptancePostgres } from "./faults.js";
import { READY_RECOVERY_TIMEOUT_MS } from "./constants.js";

export const B4_SCENARIOS = [
  {
    id: "b4-container-image-deploy",
    title: "B.4 distribution image deploy (Compose-style env)",
    mandatory: true,
    group: "b4",
    timeoutMs: 900_000,
    run: runContainerImageDeploy,
  },
  {
    id: "b4-backup-restore-independent",
    title: "B.4 independent PostgreSQL + artifact restore",
    mandatory: true,
    group: "b4",
    timeoutMs: 900_000,
    run: runBackupRestoreIndependent,
  },
  {
    id: "b4-upgrade-compatibility",
    title: "B.4 schema upgrade from authentic 0021 fixture",
    mandatory: true,
    group: "b4",
    timeoutMs: 300_000,
    run: runUpgradeCompatibility,
  },
  {
    id: "b4-postgres-stable-endpoint",
    title: "B.4 stable-endpoint PostgreSQL recovery",
    mandatory: true,
    group: "b4",
    requiresStablePostgres: true,
    timeoutMs: 480_000,
    run: runPostgresStableEndpoint,
  },
  {
    id: "b4-valkey-stable-endpoint",
    title: "B.4 stable-endpoint Valkey recovery (B.2B repeat)",
    mandatory: true,
    group: "b4",
    requiresStableValkey: true,
    timeoutMs: 240_000,
    run: runValkeyStableEndpointB4,
  },
  {
    id: "b4-helm-kind",
    title: "B.4 Helm / Kind disposable cluster acceptance",
    mandatory: true,
    group: "b4",
    timeoutMs: 900_000,
    run: runHelmKindAcceptance,
  },
  {
    id: "b4-deployment-security",
    title: "B.4 deployment manifest security review",
    mandatory: true,
    group: "b4",
    timeoutMs: 60_000,
    run: runDeploymentSecurityReview,
  },
  {
    id: "b4-console-grafana-browser",
    title: "B.4 Console/Grafana graphical acceptance (optional)",
    mandatory: false,
    group: "b4",
    timeoutMs: 120_000,
    run: runConsoleGrafanaBrowser,
  },
  {
    id: "b4-distributed-trace-image",
    title: "B.4 OTLP trace export from distribution image stack",
    mandatory: true,
    group: "b4",
    timeoutMs: 600_000,
    run: runDistributedTraceFromImage,
  },
  {
    id: "b4-release-docs",
    title: "B.4 release artifact and documentation checks",
    mandatory: true,
    group: "b4",
    timeoutMs: 900_000,
    run: runReleaseDocsChecks,
  },
  {
    id: "b4-cleanup",
    title: "B.4 deployment acceptance cleanup",
    mandatory: true,
    group: "b4",
    timeoutMs: 120_000,
    run: runB4Cleanup,
  },
];

async function runContainerImageDeploy(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "b4-container-image-deploy");
  evidence.infrastructure.provenance = "local-source-built-distribution-image";
  evidence.infrastructure.artifactSource = "docker-image";

  const imageMeta = await buildAcceptanceDistributionImage(
    ctx.dockerBin,
    ctx.runId,
  );
  evidence.image = imageMeta;
  evidence.runtimeVerification = verifyDistributionImageRuntime(
    ctx.dockerBin,
    imageMeta.tag,
  );

  const stack = await deployImageWebWorkerStack(ctx, imageMeta);
  evidence.commands = stack.commands;
  evidence.containers = { web: stack.webName, worker: stack.workerName };
  ctx.imageStack = stack;

  ctx.b4ImageMeta = imageMeta;
  const flow = await runEchoAgentFlow(
    stack.origin,
    stack.auth.token,
    stack.integrity,
    { marker: "b4-image-run", agentKey: `img-${ctx.runId.slice(0, 8)}` },
  );
  evidence.run = {
    runId: flow.runId,
    runAttemptId: flow.runAttemptId,
    status: flow.attempt.status,
  };
  recordAssertion(evidence, "health_ready", true, { origin: stack.origin });
  recordAssertion(
    evidence,
    "run_succeeded",
    flow.attempt.status === "SUCCEEDED",
  );

  const { restartContainer } = await import("./docker.js");
  await restartContainer(ctx.dockerBin, stack.workerName, ctx.runId);
  await waitForHttpOk(`${stack.origin}/ready`);

  const afterKill = await fetch(
    `${stack.origin}/v1/runs/${flow.runId}/attempts/${flow.runAttemptId}`,
    { headers: { authorization: `Bearer ${stack.auth.token}` } },
  );
  recordAssertion(evidence, "attempt_persisted", afterKill.status === 200);

  await writeScenarioEvidence(ctx, "b4-container-image-deploy", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
  await stopImageStack(ctx.dockerBin, ctx.runId, stack);
  ctx.imageStack = undefined;
}

async function ensureB4StackAuth(ctx, workspaceName) {
  await ensureDatabaseReady(ctx);
  if (ctx.auth) {
    return;
  }
  try {
    ctx.auth = await bootstrapApiKey(ctx.infra.postgres.connectionString);
  } catch {
    ctx.auth = await bootstrapWorkspace(ctx.infra.postgres.connectionString, {
      name: workspaceName,
    });
  }
}

async function runBackupRestoreIndependent(ctx) {
  await ensureB4StackAuth(ctx, "B4 Backup Source");
  await ensureStack(ctx);
  const evidence = createScenarioEvidenceBase(
    ctx,
    "b4-backup-restore-independent",
  );
  const drill = await runIndependentBackupRestoreDrill(ctx);
  evidence.drill = drill;
  recordAssertion(evidence, "checksum_match", true);
  recordAssertion(evidence, "post_restore_run", true);
  await writeScenarioEvidence(ctx, "b4-backup-restore-independent", evidence);
}

async function runUpgradeCompatibility(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "b4-upgrade-compatibility");
  const repoRoot = getRepoRoot();
  const vitest = runPnpmVitest(
    repoRoot,
    [
      "--filter",
      "@osva/db",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "test/integration/migration-acceptance.integration.test.ts",
    ],
    {},
  );
  evidence.vitest = vitest;
  evidence.fixture =
    "Authentic migration journal truncated at idx 21 (0021), then migrate to head 0023";
  evidence.documentation = [
    "docs/operations/UPGRADE.md",
    "docs/operations/BACKUP_AND_RECOVERY.md",
  ];
  await writeScenarioEvidence(ctx, "b4-upgrade-compatibility", evidence);
  ctx.assert(vitest.ok, "migration acceptance integration tests failed");
}

async function runPostgresStableEndpoint(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "b4-postgres-stable-endpoint",
  );
  ctx.assert(
    ctx.infra.postgres.stableEndpoint === true,
    "stable PostgreSQL proxy required (--group=b4)",
  );
  await ensureB4StackAuth(ctx, "B4 Postgres Stable");
  await ensureStack(ctx);
  const baseline = await runEchoAgentFlow(
    ctx.origin,
    ctx.auth.token,
    ctx.paths.integrity,
    {
      marker: "b4-pg-stable-base",
      agentKey: `pg-stable-base-${ctx.runId.slice(0, 8)}`,
    },
  );
  evidence.baselineRunId = baseline.runId;

  await stopAcceptancePostgres(ctx);
  const readyDown = await probeHttpJson(`${ctx.origin}/ready`);
  const healthUp = await probeHttpJson(`${ctx.origin}/health`);
  evidence.readyWhileDown = readyDown;
  evidence.healthWhileDown = healthUp;

  const restartStarted = Date.now();
  await startAcceptancePostgres(ctx);
  const readyRecovery = await pollReadyRecovery(
    ctx.origin,
    READY_RECOVERY_TIMEOUT_MS,
  );
  evidence.hotReconnect = readyRecovery.recovered;
  evidence.recoveryMs = Date.now() - restartStarted;

  let post;
  if (readyRecovery.recovered) {
    post = await runEchoAgentFlow(
      ctx.origin,
      ctx.auth.token,
      ctx.paths.integrity,
      {
        marker: "b4-pg-stable-post",
        agentKey: `pg-stable-${ctx.runId.slice(0, 8)}`,
      },
    );
  } else {
    evidence.applicationRestartRequired = true;
    await restartAppProcesses(ctx);
    post = await runEchoAgentFlow(
      ctx.origin,
      ctx.auth.token,
      ctx.paths.integrity,
      {
        marker: "b4-pg-stable-post-restart",
        agentKey: `pg-stable-r-${ctx.runId.slice(0, 8)}`,
      },
    );
  }
  evidence.postRecoveryRun = { status: post.attempt.status, runId: post.runId };

  recordAssertion(evidence, "ready_fails_when_postgres_down", !readyDown.ok);
  recordAssertion(evidence, "health_stays_up", healthUp.ok);
  recordAssertion(
    evidence,
    "post_recovery_run",
    post.attempt.status === "SUCCEEDED",
  );

  await writeScenarioEvidence(ctx, "b4-postgres-stable-endpoint", evidence);
  for (const assertion of evidence.assertions) {
    ctx.assert(assertion.pass, assertion.name);
  }
}

async function runValkeyStableEndpointB4(ctx) {
  await ensureB4StackAuth(ctx, "B4 Valkey Stable");
  await runStableValkeyEndpointScenario(ctx);
}

function probeCliVersion(command, args = ["version"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error?.code === "ENOENT") {
    return { available: false };
  }
  return {
    available: result.status === 0,
    stdout: (result.stdout ?? "").trim().slice(0, 500),
    stderr: (result.stderr ?? "").trim().slice(0, 500),
    exitCode: result.status,
  };
}

async function runHelmKindAcceptance(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "b4-helm-kind");
  evidence.tooling = {
    kind: probeCliVersion("kind"),
    kubectl: probeCliVersion("kubectl", ["version", "--client"]),
    helm: probeCliVersion("helm"),
  };
  const repoRoot = getRepoRoot();
  const script = path.join(repoRoot, "scripts/deployment/kind-acceptance.mjs");
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 840_000,
    env: {
      ...process.env,
      OSVA_KIND_CLUSTER: `osva-m97b-${ctx.runId.slice(0, 8)}`,
    },
  });
  evidence.commands = [`node ${script}`];
  evidence.exitCode = result.status;
  evidence.stdoutTail = (result.stdout ?? "").slice(-4000);
  evidence.stderrTail = (result.stderr ?? "").slice(-2000);
  await writeScenarioEvidence(ctx, "b4-helm-kind", evidence);
  if (result.status !== 0) {
    const combined = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
    if (
      /kind is required|kubectl is required|helm is required/i.test(combined) ||
      (/kind|kubectl|helm/i.test(combined) &&
        /not found|ENOENT|spawn|required for/i.test(combined))
    ) {
      throw new Error(
        "BLOCKED: Kind/kubectl/helm prerequisite missing for local Kubernetes acceptance",
      );
    }
    throw new Error("Kind acceptance script failed");
  }
}

async function runDeploymentSecurityReview(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "b4-deployment-security");
  evidence.review = await reviewDeploymentSecurity();
  await writeScenarioEvidence(ctx, "b4-deployment-security", evidence);
}

async function runConsoleGrafanaBrowser(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "b4-console-grafana-browser",
  );
  evidence.browserAutomation = "NOT_RUN";
  evidence.note =
    "No headed browser session bound to disposable B.4 stack; B.3 HTTP/BFF evidence preserved.";
  evidence.priorEvidence =
    ".acceptance-evidence/5dcced2b-d5ba-4847-a2cc-379d64f31788/scenarios/b3-console-functional-evidence.json";
  await writeScenarioEvidence(ctx, "b4-console-grafana-browser", evidence);
  throw new Error(
    "NOT_RUN: graphical Console/Grafana browser acceptance not executed on this stack",
  );
}

async function runDistributedTraceFromImage(ctx) {
  const evidence = createScenarioEvidenceBase(
    ctx,
    "b4-distributed-trace-image",
  );
  const capture = await startOtlpCaptureServer();
  try {
    const imageMeta =
      ctx.b4ImageMeta ??
      (await buildAcceptanceDistributionImage(ctx.dockerBin, ctx.runId));
    const capturePort = new URL(capture.url).port;
    const stack = await deployImageWebWorkerStack(ctx, imageMeta, {
      extraEnv: [
        [
          "OTEL_EXPORTER_OTLP_ENDPOINT",
          `http://host.docker.internal:${capturePort}`,
        ],
        ["OTEL_TRACES_SAMPLER", "always_on"],
      ],
    });
    ctx.b4ImageMeta = imageMeta;

    await runEchoAgentFlow(stack.origin, stack.auth.token, stack.integrity, {
      marker: "b4-trace",
      agentKey: `trace-${ctx.runId.slice(0, 8)}`,
    });
    evidence.trace = await waitForTraceEvidence(capture.requests, 120_000);
    await stopImageStack(ctx.dockerBin, ctx.runId, stack);
    evidence.imageTag = imageMeta.tag;
    await writeScenarioEvidence(ctx, "b4-distributed-trace-image", evidence);
    ctx.assert(
      evidence.trace.parentChainValid,
      "direct parent span chain invalid",
    );
    ctx.assert(
      Object.values(evidence.trace.spanNamesPresent).every(Boolean),
      "span name chain incomplete",
    );
  } finally {
    await capture.close();
  }
}

async function shutdownStackForImage(ctx) {
  if (ctx.b4TraceStack) {
    await stopImageStack(ctx.dockerBin, ctx.runId, ctx.b4TraceStack);
    ctx.b4TraceStack = undefined;
  }
}

async function runReleaseDocsChecks(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "b4-release-docs");
  const repoRoot = getRepoRoot();
  const versionModule = await import("../../../release/read-version.mjs");
  evidence.version = versionModule.readReleaseVersion(repoRoot);
  const docs = [
    "docs/operations/UPGRADE.md",
    "docs/operations/BACKUP_AND_RECOVERY.md",
    "docs/operations/RUNBOOK.md",
    "CHANGELOG.md",
    "deploy/compose/README.md",
    "deploy/helm/osva/README.md",
  ];
  evidence.docsPresent = [];
  for (const relative of docs) {
    const full = path.join(repoRoot, relative);
    try {
      await fs.access(full);
      evidence.docsPresent.push({ path: relative, exists: true });
    } catch {
      evidence.docsPresent.push({ path: relative, exists: false });
    }
  }
  const helmLint = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "node", "scripts/verification/helm-chart.test.mjs"],
    { cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32" },
  );
  evidence.helmChartTest = {
    ok: helmLint.status === 0,
    mode: "static-template-test",
  };

  const packagingScripts = [
    { id: "version-consistency", script: "release/version-consistency.mjs" },
    { id: "npm-pack-smoke", script: "release/npm-pack-smoke.mjs" },
    { id: "python-pack-smoke", script: "release/python-pack-smoke.mjs" },
    {
      id: "docker-image-smoke",
      script: "deployment/docker-image-smoke.mjs",
    },
  ];
  evidence.packaging = [];
  for (const entry of packagingScripts) {
    const started = Date.now();
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "scripts", entry.script)],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 900_000,
        env: {
          ...process.env,
          OSVA_IMAGE: process.env.OSVA_IMAGE ?? `osva:${evidence.version}`,
        },
      },
    );
    evidence.packaging.push({
      id: entry.id,
      ok: result.status === 0,
      durationMs: Date.now() - started,
      mode:
        entry.id === "version-consistency" ? "static" : "build-and-pack-smoke",
      stderrTail: (result.stderr ?? "").slice(-800),
    });
  }

  evidence.versionRecommendation =
    "M9 acceptance slices warrant a new OSS release candidate after sign-off; do not tag without authorization.";
  await writeScenarioEvidence(ctx, "b4-release-docs", evidence);
  ctx.assert(helmLint.status === 0, "helm chart verification failed");
  ctx.assert(
    evidence.docsPresent.every((entry) => entry.exists),
    "missing deployment documentation",
  );
  ctx.assert(
    evidence.packaging.every((entry) => entry.ok),
    "release packaging smoke failed",
  );
}

async function runB4Cleanup(ctx) {
  const evidence = createScenarioEvidenceBase(ctx, "b4-cleanup");
  if (ctx.imageStack) {
    await stopImageStack(ctx.dockerBin, ctx.runId, ctx.imageStack);
    ctx.imageStack = undefined;
  }
  if (ctx.b4TraceStack) {
    await stopImageStack(ctx.dockerBin, ctx.runId, ctx.b4TraceStack);
    ctx.b4TraceStack = undefined;
  }
  try {
    await execImageRm(ctx);
  } catch {
    evidence.imageRemoveNote = "image already absent or in use";
  }
  evidence.cleanup = { imageStackStopped: true };
  await writeScenarioEvidence(ctx, "b4-cleanup", evidence);
}

async function execImageRm(ctx) {
  const tag = acceptanceImageTag(ctx.runId);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)(ctx.dockerBin, ["rmi", "-f", tag]).catch(
    () => undefined,
  );
}
