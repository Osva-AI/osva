#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listGroups, resolveSteps } from "./lib/steps.mjs";
import { executeStep, REPO_ROOT, runCommandArgv } from "./lib/run-step.mjs";
import { overallVerdict, printResultsTable } from "./lib/report.mjs";

/** @typedef {import("./lib/steps.mjs").AcceptanceProfile} AcceptanceProfile */

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ profile: AcceptanceProfile, group?: string, help: boolean, list: boolean }} */
  const options = {
    profile: "default",
    group: undefined,
    help: false,
    list: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length);
      if (
        value === "default" ||
        value === "integration" ||
        value === "browser" ||
        value === "full"
      ) {
        options.profile = value;
      } else {
        throw new Error(`Unknown profile: ${value}`);
      }
    } else if (arg.startsWith("--group=")) {
      options.group = arg.slice("--group=".length);
    } else if (arg === "--list") {
      options.list = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm acceptance:m15 [--profile=default|integration|browser|full] [--group=bootstrap|…]

Unified M15 production adoption acceptance (orchestration only — reuses existing suites).

Profiles:
  default      Fast adoption checks (no Docker): RC4 alignment, migrations manifest,
               operator diagnostics, evaluation unit/REST, M14 adversarial + HTTP isolation.
  integration  default + Docker-backed integration (human session, M12.3, worker, canonical E2E, approval DB).
  browser      Console Playwright journeys (M12.3 browser, onboarding, Agent Studio, workflow, eval gates).
  full         All of the above sequentially, plus optional npm @rc registry check.

Examples:
  pnpm acceptance:m15
  pnpm acceptance:m15 -- --profile=integration
  pnpm acceptance:m15 -- --profile=browser --group=evaluation
  pnpm acceptance:m15 -- --list

Prerequisites:
  - pnpm install
  - Docker for integration/browser profiles (\`pnpm verify:docker\`)
  - Playwright chromium for browser steps (\`pnpm exec playwright install chromium\`)

Evidence JSON: artifacts/acceptance/m15-4/latest.json (gitignored)
`);
}

function probeDockerReady() {
  const result = spawnSync(
    process.execPath,
    ["scripts/verification/docker-preflight.mjs"],
    {
      cwd: REPO_ROOT,
      stdio: "pipe",
      shell: false,
    },
  );
  return result.status === 0;
}

/**
 * @param {AcceptanceProfile} profile
 */
function ensureBrowserPrerequisites(profile) {
  const steps = resolveSteps(profile, undefined);
  if (!steps.some((step) => step.requiresBrowser)) {
    return true;
  }
  const install = runCommandArgv([
    "pnpm",
    "exec",
    "playwright",
    "install",
    ...(process.env.CI === "true" ? ["--with-deps"] : []),
    "chromium",
  ]);
  if (install.exitCode !== 0) {
    return false;
  }
  const build = runCommandArgv([
    "pnpm",
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=@osva/console",
    "--filter=@osva/web",
    "--filter=@osva/worker",
  ]);
  return build.exitCode === 0;
}

async function writeEvidence(profile, results, verdict) {
  const dir = path.join(REPO_ROOT, "artifacts/acceptance/m15-4");
  await fs.mkdir(dir, { recursive: true });
  const payload = {
    acceptance: "m15-4",
    profile,
    finishedAt: new Date().toISOString(),
    verdict,
    results,
  };
  const latest = path.join(dir, "latest.json");
  await fs.writeFile(latest, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Evidence: ${latest}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.list) {
    console.log("Groups:");
    for (const group of listGroups()) {
      console.log(`  ${group.id}\t${group.label}`);
    }
    console.log("");
    console.log("Steps:");
    for (const step of resolveSteps(options.profile, options.group)) {
      console.log(
        `${step.id}\t${step.group}\t${step.journey}\t${step.command}`,
      );
    }
    return;
  }

  const steps = resolveSteps(options.profile, options.group);
  if (steps.length === 0) {
    console.error("No steps matched profile/group selection.");
    process.exitCode = 1;
    return;
  }

  const needsDocker = steps.some((step) => step.requiresDocker);
  const dockerReady = needsDocker ? probeDockerReady() : false;
  if (needsDocker && !dockerReady) {
    console.error(
      "Docker is required for this profile but the engine is not ready.",
    );
    console.error("Run: pnpm verify:docker");
  }

  if (
    options.profile === "browser" ||
    options.profile === "full" ||
    steps.some((s) => s.requiresBrowser)
  ) {
    if (!ensureBrowserPrerequisites(options.profile)) {
      console.error("Browser prerequisite build or Playwright install failed.");
      process.exitCode = 1;
      return;
    }
  }

  /** @type {import("./lib/run-step.mjs").StepResult[]} */
  const results = [];
  for (const step of steps) {
    console.log("");
    console.log(`--- ${step.id} (${step.group}) ---`);
    console.log(step.command);
    const result = executeStep(step, { dockerReady, skipped: false });
    results.push(result);
    if (result.status === "FAIL") {
      console.error(`Step failed: ${step.id}`);
    }
  }

  printResultsTable(results, options.profile);
  const verdict = overallVerdict(results);
  console.log("");
  console.log(`Verdict: ${verdict}`);
  await writeEvidence(options.profile, results, verdict);

  if (verdict === "FAIL") {
    process.exitCode = 1;
  } else if (verdict === "BLOCKED") {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
