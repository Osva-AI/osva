#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadBudgetFromEnv } from "./lib/budgets.mjs";
import { liveBlockedReason } from "./lib/live-guards.mjs";
import { writeAcceptanceArtifacts } from "./lib/report.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ mode: "deterministic" | "live", provider?: string, smoke: boolean, help: boolean, withBrowser: boolean }} */
  const options = {
    mode: "deterministic",
    provider: undefined,
    smoke: false,
    help: false,
    withBrowser: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--live") {
      options.mode = "live";
    } else if (arg.startsWith("--provider=")) {
      options.provider = arg.slice("--provider=".length).toLowerCase();
      options.mode = "live";
    } else if (arg === "--smoke") {
      options.smoke = true;
    } else if (arg === "--with-browser") {
      options.withBrowser = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm acceptance:m20-6 [--smoke] [--with-browser]
       pnpm acceptance:m20-6:live -- --provider=openai|gemini [--smoke]

M20.6 builder product acceptance (deterministic fake provider by default).

Deterministic mode (CI-safe):
  - Disposable Docker PostgreSQL/Valkey + Web + Console BFF
  - Fake OpenAI builder responses keyed by OSVA_M20_6_SCENARIO markers
  - No billable provider calls

Live provider mode (operator opt-in only):
  - Set OSVA_M20_6_LIVE=1 and configure workspace credentials via env (never commit)
  - Optional: OSVA_M20_6_GENERATION_MODEL=<provider-model-id>
  - Never runs in CI unless explicitly invoked

Budget env (optional):
  OSVA_M20_6_MAX_BUILDER_REQUESTS, OSVA_M20_6_MAX_PROVIDER_INVOCATIONS,
  OSVA_M20_6_MAX_TOTAL_DURATION_MS, OSVA_M20_6_MAX_COST_USD_MICROS

Artifacts: artifacts/m20-6/acceptance-results.json (gitignored)
`);
}

function run(argv, env = process.env) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "pnpm.cmd" : "pnpm";
  return spawnSync(cmd, argv, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: isWin,
    env,
  });
}

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const dockerPreflight = spawnSync(
    process.execPath,
    ["scripts/verification/docker-preflight.mjs"],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    },
  );
  if (dockerPreflight.status !== 0) {
    process.exit(dockerPreflight.status ?? 1);
  }

  const build = run([
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=@osva/console",
    "--filter=@osva/web",
    "--filter=@osva/db",
    "--filter=@osva/adapters-bullmq",
  ]);
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  const budget = loadBudgetFromEnv(process.env);
  const env = {
    ...process.env,
    OSVA_M20_6_RUNNER: "scripts/acceptance/m20-6/run.mjs",
    OSVA_M20_6_SMOKE: options.smoke ? "1" : process.env.OSVA_M20_6_SMOKE,
    OSVA_M20_6_MAX_BUILDER_REQUESTS: String(budget.maxBuilderRequests),
    OSVA_M20_6_MAX_PROVIDER_INVOCATIONS: String(budget.maxProviderInvocations),
    OSVA_M20_6_MAX_TOTAL_DURATION_MS: String(budget.maxTotalDurationMs),
  };

  let blockedPrerequisite;

  if (options.mode === "live") {
    blockedPrerequisite = liveBlockedReason(process.env, options.provider);
    console.warn(`LIVE_PROVIDER_NOT_RUN: ${blockedPrerequisite}`);
    const forward = spawnSync(
      process.execPath,
      [
        "scripts/acceptance/m20-7/run.mjs",
        "--preflight",
        ...(options.provider
          ? [`--provider=${options.provider}`]
          : ["--provider=openai"]),
        ...(options.smoke ? ["--smoke"] : []),
      ],
      { cwd: REPO_ROOT, stdio: "inherit", env: process.env },
    );
    process.exit(forward.status ?? 2);
  }

  const vitestArgs = [
    "--filter",
    "@osva/console",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "test/integration/m20-6-builder-acceptance.integration.test.ts",
  ];

  const integration = run(vitestArgs, env);

  let browserStatus = 0;
  if (options.withBrowser && blockedPrerequisite === undefined) {
    const install = run(["exec", "playwright", "install", "chromium"]);
    if (install.status !== 0) {
      process.exit(install.status ?? 1);
    }
    const browser = run(
      [
        "--filter",
        "@osva/console",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.integration.browser.config.ts",
        "test/integration/m20-6-browser.integration.test.ts",
      ],
      env,
    );
    browserStatus = browser.status ?? 1;
  }

  const manifest = JSON.parse(
    await fs.readFile(
      path.join(REPO_ROOT, "scripts/acceptance/m20-6/scenarios/manifest.json"),
      "utf8",
    ),
  );

  /** @type {Record<string, unknown> | null} */
  let integrationEvidence = null;
  try {
    integrationEvidence = JSON.parse(
      await fs.readFile(
        path.join(REPO_ROOT, "artifacts/m20-6/acceptance-results.json"),
        "utf8",
      ),
    );
  } catch {
    integrationEvidence = null;
  }

  const perScenario = Array.isArray(integrationEvidence?.results)
    ? integrationEvidence.results
    : [];

  const payload = {
    runnerVersion: "m20-6.0",
    sourceCommit: gitCommit(),
    executionTimestamp: new Date().toISOString(),
    mode: options.mode,
    liveProviderCalls: integrationEvidence?.liveProviderCalls === true,
    liveProvider: options.provider,
    blockedPrerequisite,
    budget,
    scenarioCatalogVersion: manifest.schemaVersion,
    scenarioCount: perScenario.length,
    allScenariosExecuted: integrationEvidence?.allScenariosExecuted === true,
    scenarios:
      perScenario.length > 0
        ? perScenario
        : (manifest.scenarios ?? []).map((s) => ({
            id: s.id,
            status:
              blockedPrerequisite !== undefined
                ? "NOT_RUN"
                : integration.status === 0
                  ? "ERROR"
                  : "FAIL",
          })),
    openAiRequestCount: integrationEvidence?.openAiRequestCount,
    notes:
      blockedPrerequisite !== undefined
        ? `Live mode blocked: ${blockedPrerequisite}`
        : integration.status !== 0
          ? "Integration suite failed — see logs."
          : perScenario.length === 0
            ? "Integration passed but per-scenario evidence missing."
            : "Integration suite completed.",
  };

  await writeAcceptanceArtifacts(REPO_ROOT, payload);

  if (integration.status !== 0) {
    process.exit(integration.status ?? 1);
  }
  if (browserStatus !== 0) {
    process.exit(browserStatus);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
