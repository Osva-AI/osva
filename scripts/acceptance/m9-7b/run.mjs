#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { EVIDENCE_ROOT_DIR } from "./lib/constants.js";
import {
  assertDockerReady,
  findDockerBin,
  listForeignManagedContainers,
  listManagedContainers,
  snapshotDockerState,
} from "./lib/docker.js";
import {
  createEvidenceLayout,
  createScenarioResult,
  finalizeScenarioResult,
  writeJson,
  writeSummaryMd,
} from "./lib/evidence.js";
import { startAcceptanceInfra, stopAcceptanceInfra } from "./lib/infra.js";
import {
  listScenarios,
  resolveScenarios,
  scenarioNeedsStablePostgres,
  scenarioNeedsStableValkey,
} from "./lib/scenarios.js";
import {
  classifyScenarioError,
  failsMandatoryGroup,
} from "./lib/scenario-status.js";
import { withTimeout } from "./lib/timeouts.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function parseArgs(argv) {
  const options = {
    list: false,
    retain: false,
    scenarios: [],
    group: undefined,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (arg === "--retain") {
      options.retain = true;
      continue;
    }
    if (arg.startsWith("--scenario=")) {
      options.scenarios.push(arg.slice("--scenario=".length));
      continue;
    }
    if (arg.startsWith("--group=")) {
      options.group = arg.slice("--group=".length);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm acceptance:m9-7b [--scenario=id]... [--group=b2|b3|b4] [--retain] [--list]

Runs the M9.7B disposable real-stack acceptance harness.
Use --group=b2 for execution durability scenarios (stable Valkey proxy).
Use --group=b3 for integrated security, workflow, Console and observability.
Use --group=b4 for deployment, upgrade and disaster-recovery acceptance.
Requires Docker (for isolated PostgreSQL and Valkey only).
`);
}

function gitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.list) {
    for (const scenario of listScenarios()) {
      console.log(
        `${scenario.id}\t${scenario.mandatory ? "mandatory" : "optional"}\t${scenario.title}`,
      );
    }
    return;
  }

  const runId = randomUUID();
  const startedAt = new Date();
  const evidenceDir = path.join(REPO_ROOT, EVIDENCE_ROOT_DIR, runId);
  await createEvidenceLayout(evidenceDir);

  const dockerBin = await findDockerBin();
  if (!dockerBin) {
    await failBlocked(runId, evidenceDir, startedAt, "Docker CLI not found");
    return;
  }

  try {
    await assertDockerReady(dockerBin);
  } catch (error) {
    await failBlocked(
      runId,
      evidenceDir,
      startedAt,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  const manifest = {
    runId,
    gitSha: gitSha(),
    startedAt: startedAt.toISOString(),
    nodeVersion: process.version,
    pnpmVersion: process.env.npm_package_manager ?? "unknown",
    telemetryMode: "disabled",
    artifactSource: "local-build",
    resources: {},
  };

  const report = {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: undefined,
    verdict: "FAIL",
    scenarios: [],
    cleanup: undefined,
  };

  let infra;
  const ctx = {
    runId,
    dockerBin,
    evidenceDir,
    foreignAcceptanceAtStart: await listForeignManagedContainers(
      dockerBin,
      runId,
    ),
    assert(condition, message) {
      if (!condition) {
        throw new Error(message);
      }
    },
  };

  try {
    ctx.dockerSnapshotBefore = await snapshotDockerState(dockerBin);
    await writeJson(
      path.join(evidenceDir, "environment", "docker-snapshot-before.json"),
      ctx.dockerSnapshotBefore,
    );

    const scenarios = resolveScenarios(options.scenarios, {
      group: options.group,
    });
    if (options.group === "b3") {
      manifest.telemetryMode = "optional-collector";
    }
    if (options.group === "b4") {
      manifest.telemetryMode = "optional-collector";
      manifest.artifactSource = "mixed-local-image-and-source";
    }
    infra = await startAcceptanceInfra(dockerBin, runId, {
      stableValkeyEndpoint: scenarioNeedsStableValkey(scenarios),
      stablePostgresEndpoint: scenarioNeedsStablePostgres(scenarios),
    });
    ctx.infra = infra;
    manifest.resources = {
      postgresContainer: infra.postgres.containerName,
      valkeyContainer: infra.valkey.containerName,
      postgresPort: infra.postgres.hostPort,
      valkeyPort: infra.valkey.hostPort,
    };
    await writeJson(path.join(evidenceDir, "manifest.json"), manifest);

    let mandatoryFailed = false;

    for (const scenario of scenarios) {
      const started = new Date();
      const result = createScenarioResult(scenario.id, started.toISOString());
      try {
        await withTimeout(
          scenario.run(ctx),
          scenario.timeoutMs ?? 120_000,
          scenario.id,
        );
        finalizeScenarioResult(result, "PASS", new Date());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = classifyScenarioError(message);
        result.error = status === "PASS" ? undefined : message;
        finalizeScenarioResult(result, status, new Date());
        if (failsMandatoryGroup(status, scenario.mandatory)) {
          mandatoryFailed = true;
        }
      }
      report.scenarios.push(result);
      await writeJson(
        path.join(evidenceDir, "scenarios", `${scenario.id}.json`),
        result,
      );
      if (mandatoryFailed && scenario.mandatory) {
        break;
      }
    }

    const optionalOutcomes = report.scenarios.filter(
      (entry) =>
        !listScenarios().find((scenario) => scenario.id === entry.name)
          ?.mandatory,
    );
    report.optionalSummary = {
      blocked: optionalOutcomes.filter((entry) => entry.status === "BLOCKED")
        .length,
      notRun: optionalOutcomes.filter((entry) => entry.status === "NOT_RUN")
        .length,
      failed: optionalOutcomes.filter((entry) => entry.status === "FAIL")
        .length,
    };
    report.verdict = mandatoryFailed ? "FAIL" : "PASS";
  } catch (error) {
    report.verdict = "FAIL";
    report.scenarios.push({
      name: "runner",
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    report.finishedAt = new Date().toISOString();
    if (ctx.processes && !ctx.stackStopped) {
      try {
        const { shutdownStack } = await import("./lib/stack-context.js");
        await shutdownStack(ctx);
      } catch {
        // best effort
      }
    }

    const cleanup = { status: "PASS", retainedResources: [] };
    if (infra && !options.retain) {
      try {
        await stopAcceptanceInfra(dockerBin, infra);
      } catch (error) {
        cleanup.status = "FAIL";
        cleanup.error = error instanceof Error ? error.message : String(error);
      }
    } else if (infra && options.retain) {
      cleanup.status = "RETAINED";
      cleanup.retainedResources = await listManagedContainers(dockerBin, runId);
    }
    report.cleanup = cleanup;

    await writeJson(path.join(evidenceDir, "report.json"), report);
    await writeSummaryMd(
      path.join(evidenceDir, "report.json"),
      path.join(evidenceDir, "summary.md"),
    );

    console.log(`Evidence: ${evidenceDir}`);
    console.log(`Verdict: ${report.verdict}`);
    if (report.verdict !== "PASS") {
      process.exitCode = 1;
    }
  }
}

async function failBlocked(runId, evidenceDir, startedAt, reason) {
  const report = {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    verdict: "BLOCKED",
    scenarios: [
      {
        name: "preflight",
        status: "BLOCKED",
        error: reason,
      },
    ],
  };
  await writeJson(path.join(evidenceDir, "manifest.json"), {
    runId,
    blocked: reason,
  });
  await writeJson(path.join(evidenceDir, "report.json"), report);
  await writeSummaryMd(
    path.join(evidenceDir, "report.json"),
    path.join(evidenceDir, "summary.md"),
  );
  console.error(`BLOCKED: ${reason}`);
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
