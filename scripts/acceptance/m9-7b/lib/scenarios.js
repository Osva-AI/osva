import fs from "node:fs/promises";
import path from "node:path";

import {
  findUnauthorizedContainerRemovals,
  listForeignManagedContainers,
  listManagedContainers,
  snapshotDockerState,
} from "./docker.js";
import { READY_RECOVERY_TIMEOUT_MS } from "./constants.js";
import { writeJson } from "./evidence.js";
import { restartValkeyDependency, stopAcceptanceValkey } from "./faults.js";
import {
  queryPostgresStatus,
  refreshValkeyEndpoint,
  runDbCli,
} from "./infra.js";
import {
  describeProcessState,
  getRepoRoot,
  pollReadyRecovery,
  probeHttpJson,
  runEchoAgentFlow,
  waitForHttpOk,
} from "./stack.js";
import {
  ensureStack,
  restartAppProcesses,
  shutdownStack,
} from "./stack-context.js";
import { B2_SCENARIOS } from "./b2-scenarios.js";
import { B3_SCENARIOS } from "./b3-scenarios.js";
import { B4_SCENARIOS } from "./b4-scenarios.js";
import { withTimeout } from "./timeouts.js";
import { waitForHostValkeyReady } from "./valkey-probe.js";

export function listScenarios() {
  return allScenarios().map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    mandatory: scenario.mandatory,
    group: scenario.group ?? "core",
  }));
}

export function resolveScenarios(selectedIds, options = {}) {
  const catalog = allScenarios();
  if (selectedIds.length === 0) {
    if (options.group === "b2") {
      return catalog.filter((scenario) => scenario.group === "b2");
    }
    if (options.group === "b3") {
      return catalog.filter((scenario) => scenario.group === "b3");
    }
    if (options.group === "b4") {
      return catalog.filter((scenario) => scenario.group === "b4");
    }
    return catalog.filter(
      (scenario) =>
        scenario.group !== "b2" &&
        scenario.group !== "b3" &&
        scenario.group !== "b4",
    );
  }
  const chosen = catalog.filter((scenario) =>
    selectedIds.includes(scenario.id),
  );
  if (chosen.length === 0) {
    throw new Error(`Unknown scenario selection: ${selectedIds.join(", ")}`);
  }
  return chosen;
}

export function scenarioNeedsStableValkey(selectedScenarios) {
  return selectedScenarios.some(
    (scenario) => scenario.requiresStableValkey === true,
  );
}

export function scenarioNeedsStablePostgres(selectedScenarios) {
  return selectedScenarios.some(
    (scenario) => scenario.requiresStablePostgres === true,
  );
}

function allScenarios() {
  return [...CORE_SCENARIOS, ...B2_SCENARIOS, ...B3_SCENARIOS, ...B4_SCENARIOS];
}

export function listScenariosInternal() {
  return allScenarios();
}

const CORE_SCENARIOS = [
  {
    id: "startup",
    title: "A. Clean disposable environment startup",
    mandatory: true,
    run: async (ctx) => {
      ctx.assert(ctx.infra !== undefined, "infra started");
      ctx.assert(ctx.infra.postgres.containerName.length > 0, "postgres named");
      ctx.assert(ctx.infra.valkey.containerName.length > 0, "valkey named");
      await writeJson(
        path.join(ctx.evidenceDir, "environment", "infra.json"),
        ctx.infra,
      );
    },
  },
  {
    id: "schema",
    title: "B. PostgreSQL migration and integrity verification",
    mandatory: true,
    run: async (ctx) => {
      const repoRoot = getRepoRoot();
      await withTimeout(
        runDbCli(
          repoRoot,
          "migrate-cli.js",
          ctx.infra.postgres.connectionString,
        ),
        120_000,
        "db migrate",
      );
      const integrityOutput = await withTimeout(
        (async () => {
          const { spawnSync } = await import("node:child_process");
          const result = spawnSync(
            process.execPath,
            [
              path.join(
                repoRoot,
                "packages/db/dist/migrations-integrity-cli.js",
              ),
              ctx.infra.postgres.connectionString,
            ],
            { encoding: "utf8" },
          );
          if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout);
          }
          return result.stdout;
        })(),
        120_000,
        "db integrity",
      );
      ctx.assert(
        integrityOutput.includes("schema integrity: applied_and_matches"),
        "schema integrity CLI passed",
      );
      await fs.writeFile(
        path.join(ctx.evidenceDir, "postgres", "integrity.txt"),
        integrityOutput,
        "utf8",
      );
    },
  },
  {
    id: "health",
    title: "C. API /health and /ready",
    mandatory: true,
    run: async (ctx) => {
      await ensureStack(ctx);
      await waitForHttpOk(`${ctx.origin}/health`);
      await waitForHttpOk(`${ctx.origin}/ready`);
      const health = await fetch(`${ctx.origin}/health`);
      const ready = await fetch(`${ctx.origin}/ready`);
      ctx.assert(health.status === 200, "/health is 200");
      ctx.assert(ready.status === 200, "/ready is 200");
    },
  },
  {
    id: "agent-run",
    title: "D. Deterministic Agent Run via Web, BullMQ, Worker, PostgreSQL",
    mandatory: true,
    run: async (ctx) => {
      await ensureStack(ctx);
      const flow = await runEchoAgentFlow(
        ctx.origin,
        ctx.auth.token,
        ctx.paths.integrity,
      );
      ctx.flow = flow;
      ctx.assert(flow.attempt.status === "SUCCEEDED", "attempt succeeded");
      ctx.assert(
        flow.attempt.output?.echoed?.marker === "m9-7b",
        "output marker matches",
      );
      await writeJson(
        path.join(ctx.evidenceDir, "scenarios", "agent-run.json"),
        {
          runId: flow.runId,
          runAttemptId: flow.runAttemptId,
          status: flow.attempt.status,
        },
      );
    },
  },
  {
    id: "durable-outcome",
    title: "E. Durable RunAttempt outcome via API and database",
    mandatory: true,
    run: async (ctx) => {
      if (!ctx.flow) {
        await ensureStack(ctx);
        ctx.flow = await runEchoAgentFlow(
          ctx.origin,
          ctx.auth.token,
          ctx.paths.integrity,
        );
      }
      const pgStatus = await queryPostgresStatus(
        ctx.dockerBin,
        ctx.infra,
        ctx.flow.runAttemptId,
      );
      ctx.assert(pgStatus === "SUCCEEDED", "postgres run_attempt status");
      const apiAttempt = await fetch(
        `${ctx.origin}/v1/runs/${ctx.flow.runId}/attempts/${ctx.flow.runAttemptId}`,
        { headers: { authorization: `Bearer ${ctx.auth.token}` } },
      );
      ctx.assert(apiAttempt.status === 200, "public attempt GET");
      const body = await apiAttempt.json();
      ctx.assert(body.status === "SUCCEEDED", "api attempt status");
      await writeJson(
        path.join(ctx.evidenceDir, "postgres", "run-attempt-status.json"),
        {
          pgStatus,
          apiStatus: body.status,
          runAttemptId: ctx.flow.runAttemptId,
        },
      );
    },
  },
  {
    id: "fault-valkey-restart",
    title: "Valkey stop/restart with OSVA readiness and post-recovery Run",
    mandatory: true,
    timeoutMs: 180_000,
    run: async (ctx) => {
      await ensureStack(ctx);
      const processesBefore = {
        web: describeProcessState(ctx.processes.web, "web"),
        worker: describeProcessState(ctx.processes.worker, "worker"),
      };
      const baselineReady = await probeHttpJson(`${ctx.origin}/ready`);
      ctx.assert(baselineReady.ok, "baseline /ready");

      await stopAcceptanceValkey(ctx);
      const readyWhileDown = await probeHttpJson(`${ctx.origin}/ready`);
      const healthWhileDown = await probeHttpJson(`${ctx.origin}/health`);

      const restartStarted = Date.now();
      await restartValkeyDependency(ctx, { skipStop: true });
      const portRefresh = await refreshValkeyEndpoint(ctx.dockerBin, ctx.infra);
      try {
        await waitForHostValkeyReady(ctx.infra.valkey.url);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Valkey did not recover after restart: ${message}`);
      }
      const msToHostValkey = Date.now() - restartStarted;

      let applicationRestartRequired = false;
      if (portRefresh.portChanged) {
        applicationRestartRequired = true;
        await restartAppProcesses(ctx);
      }

      const readyRecovery = await pollReadyRecovery(
        ctx.origin,
        READY_RECOVERY_TIMEOUT_MS,
      );

      let postRecoveryRun;
      if (readyRecovery.recovered) {
        postRecoveryRun = await runEchoAgentFlow(
          ctx.origin,
          ctx.auth.token,
          ctx.paths.integrity,
          {
            marker: "m9-7b-post-valkey-restart",
            agentKey: `echo-agent-restart-${ctx.runId.slice(0, 8)}`,
          },
        );
      }

      const evidence = {
        processesBefore,
        processesAfter: {
          web: describeProcessState(ctx.processes.web, "web"),
          worker: describeProcessState(ctx.processes.worker, "worker"),
        },
        valkeyPortRefresh: portRefresh,
        applicationRestartRequired,
        baselineReady: sanitizeReadyProbe(baselineReady),
        readyWhileDown: sanitizeReadyProbe(readyWhileDown),
        healthWhileDown,
        msToHostValkey,
        readyRecovery: {
          recovered: readyRecovery.recovered,
          msToReady: readyRecovery.msToReady,
          sampleCount: readyRecovery.samples.length,
          lastSample: sanitizeReadyProbe(
            readyRecovery.samples[readyRecovery.samples.length - 1] ?? {},
          ),
        },
        postRecoveryRun: postRecoveryRun
          ? {
              runId: postRecoveryRun.runId,
              runAttemptId: postRecoveryRun.runAttemptId,
              status: postRecoveryRun.attempt.status,
            }
          : undefined,
      };
      await writeJson(
        path.join(ctx.evidenceDir, "valkey", "fault-valkey-restart.json"),
        evidence,
      );

      ctx.assert(!readyWhileDown.ok, "ready fails closed while Valkey is down");
      ctx.assert(healthWhileDown.ok, "/health stays available");
      ctx.assert(readyRecovery.recovered, "/ready recovers after host Valkey");
      ctx.assert(
        postRecoveryRun?.attempt.status === "SUCCEEDED",
        "post-recovery run succeeded",
      );
    },
  },
  {
    id: "shutdown",
    title: "F. Graceful shutdown and cleanup",
    mandatory: true,
    run: async (ctx) => {
      await shutdownStack(ctx);
      ctx.assert(ctx.stackStopped === true, "stack stopped");
    },
  },
  {
    id: "isolation-audit",
    title: "G. No unrelated Docker resources modified",
    mandatory: true,
    run: async (ctx) => {
      const foreign = await listForeignManagedContainers(
        ctx.dockerBin,
        ctx.runId,
      );
      const startIds = new Set(
        (ctx.foreignAcceptanceAtStart ?? []).map((entry) => entry.id),
      );
      const newlyAppeared = foreign.filter((entry) => !startIds.has(entry.id));
      ctx.assert(
        newlyAppeared.length === 0,
        `this run created foreign acceptance containers: ${newlyAppeared.length}`,
      );

      const dockerAfter = await snapshotDockerState(ctx.dockerBin);
      const unauthorizedRemovals = ctx.dockerSnapshotBefore
        ? findUnauthorizedContainerRemovals(
            ctx.dockerSnapshotBefore,
            dockerAfter,
            ctx.runId,
          )
        : [];

      ctx.assert(
        unauthorizedRemovals.length === 0,
        `unauthorized container removals: ${unauthorizedRemovals.length}`,
      );

      const owned = await listManagedContainers(ctx.dockerBin, ctx.runId);
      await writeJson(
        path.join(ctx.evidenceDir, "security", "isolation-audit.json"),
        {
          foreignAtStart: ctx.foreignAcceptanceAtStart ?? [],
          foreignAtEnd: foreign,
          newlyAppeared,
          unauthorizedRemovals,
          ownedContainersThisRun: owned,
          dockerSnapshotAfter: dockerAfter,
        },
      );
    },
  },
];

const SCENARIOS = CORE_SCENARIOS;

function sanitizeReadyProbe(probe) {
  if (!probe || typeof probe !== "object") {
    return probe;
  }
  const body = probe.body;
  if (body && typeof body === "object") {
    return {
      ok: probe.ok,
      status: probe.status,
      durationMs: probe.durationMs,
      body: {
        status: body.status,
        failedDependency: body.failedDependency,
        failedDependencies: body.failedDependencies,
      },
    };
  }
  return {
    ok: probe.ok,
    status: probe.status,
    durationMs: probe.durationMs,
    error: probe.error,
  };
}
