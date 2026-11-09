#!/usr/bin/env node
/**
 * M20.7.3 — isolated Gemini Builder generation probe (operator-controlled).
 *
 * Default: dry-run integration preflight (zero provider calls).
 *
 * Billable execute (one generation HTTP call, max one provider invocation):
 *   OSVA_M20_7_LIVE_EXECUTE=1
 *   OSVA_M20_7_ALLOW_BILLABLE=1
 *   GOOGLE_GEMINI_API_KEY=...
 *   pnpm acceptance:m20-7:gemini-probe -- --execute
 *
 * Artifact: artifacts/m20-7/gemini-generation-probe.json (does not overwrite acceptance-results.json)
 */
import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  estimateGeminiProbeWorstCaseMicroUsd,
  geminiGenerationProbeBaseEnv,
  geminiGenerationProbeExecuteBlockedReason,
  geminiGenerationProbeExecuteExitCode,
  M20_7_GEMINI_PROBE_ARTIFACT,
} from "./lib/gemini-generation-probe.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  let execute = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--execute") {
      execute = true;
    } else if (arg === "--dry-run" || arg === "--preflight") {
      execute = false;
    }
  }
  return { execute, help };
}

function printHelp() {
  console.log(`M20.7.3 Gemini builder generation probe

Usage:
  pnpm acceptance:m20-7:gemini-probe              # dry-run (default)
  pnpm acceptance:m20-7:gemini-probe -- --execute # one billable provider call

Requires for execute:
  OSVA_M20_7_LIVE_EXECUTE=1
  OSVA_M20_7_ALLOW_BILLABLE=1
  GOOGLE_GEMINI_API_KEY (or GEMINI_API_KEY)
  OSVA_M20_7_MAX_COST_USD_MICROS (default 250000 micro-USD)

Model: gemini-3.6-flash (override blocked unless unset)
Artifact: artifacts/m20-7/${M20_7_GEMINI_PROBE_ARTIFACT}
`);
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

function runVitestProbe(env) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "pnpm.cmd" : "pnpm";
  return spawnSync(
    cmd,
    [
      "--filter",
      "@osva/console",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "test/integration/m20-7-gemini-generation-probe.integration.test.ts",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: isWin,
      env,
    },
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const env = geminiGenerationProbeBaseEnv(process.env);
  if (!options.execute) {
    delete env.OSVA_M20_7_LIVE_EXECUTE;
    delete env.OSVA_M20_7_ALLOW_BILLABLE;
  }

  const blocked = options.execute
    ? geminiGenerationProbeExecuteBlockedReason(env)
    : undefined;
  const worstCaseCost = estimateGeminiProbeWorstCaseMicroUsd(env);

  console.log(
    JSON.stringify(
      {
        harnessVersion: "m20-7.3",
        mode: options.execute ? "execute" : "dry_run",
        sourceCommit: gitCommit(),
        modelId: env.OSVA_M20_7_GENERATION_MODEL,
        provider: "GOOGLE_GEMINI",
        structuredOutputWire: "responseJsonSchema",
        maxProviderInvocations: 1,
        maxInputTokensPerAttempt: Number(env.OSVA_M20_7_MAX_INPUT_TOKENS),
        maxOutputTokensPerAttempt: Number(env.OSVA_M20_7_MAX_OUTPUT_TOKENS),
        maxEstimatedCostUsdMicros: Number(env.OSVA_M20_7_MAX_COST_USD_MICROS),
        estimatedWorstCaseMicroUsd: worstCaseCost.estimatedMicroUsd ?? null,
        estimatedWorstCaseReason: worstCaseCost.reason ?? null,
        executeBlockedReason: blocked ?? null,
      },
      null,
      2,
    ),
  );

  if (options.execute && blocked !== undefined) {
    console.error(`PROBE_BLOCKED: ${blocked}`);
    process.exit(2);
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

  const build = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@osva/console",
      "--filter=@osva/web",
      "--filter=@osva/db",
      "--filter=@osva/adapters-bullmq",
      "--filter=@osva/adapters-model-gemini",
      "--filter=@osva/model-gateway",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  const result = runVitestProbe(env);
  const code = result.status ?? 1;
  if (code !== 0) {
    process.exit(code);
  }

  if (options.execute) {
    try {
      const artifactPath = path.join(
        REPO_ROOT,
        "artifacts",
        "m20-7",
        M20_7_GEMINI_PROBE_ARTIFACT,
      );
      const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
      const exitCode = geminiGenerationProbeExecuteExitCode(artifact.outcome);
      process.exit(exitCode);
    } catch {
      process.exit(1);
    }
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("PROBE_FAILED", error?.message ?? String(error));
  process.exit(2);
});
