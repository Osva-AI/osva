#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadAndValidateBudgetFromEnv } from "./lib/budgets.mjs";
import {
  evaluateLivePreflight,
  liveExecuteBlockedReason,
} from "./lib/live-guards.mjs";
import {
  assertLiveReportConsistency,
  writeAcceptanceArtifacts,
} from "./lib/report.mjs";
import {
  createEmptyProvenance,
  deriveLiveProviderCallsFlag,
} from "./lib/provenance.mjs";
import {
  MODEL_PRICING_VERSION,
  MODEL_PRICING_RATE_SOURCE,
} from "./lib/pricing.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ command: "deterministic" | "preflight" | "live" | "regression", provider?: string, smoke: boolean, help: boolean, withBrowser: boolean, publish: boolean }} */
  const options = {
    command: "deterministic",
    provider: undefined,
    smoke: false,
    help: false,
    withBrowser: false,
    publish: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--preflight" || arg === "--dry-run") {
      options.command = "preflight";
    } else if (arg === "--live") {
      options.command = "live";
    } else if (arg === "--regression") {
      options.command = "regression";
    } else if (arg.startsWith("--provider=")) {
      options.provider = arg.slice("--provider=".length).toLowerCase();
      if (options.command === "deterministic") {
        options.command = "preflight";
      }
    } else if (arg === "--smoke") {
      options.smoke = true;
    } else if (arg === "--with-browser") {
      options.withBrowser = true;
    } else if (arg === "--publish") {
      options.publish = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  pnpm acceptance:m20-7                     # M20.6 deterministic matrix (CI-safe)
  pnpm acceptance:m20-7:regression          # M20.7 routing/guard regression (no providers)
  pnpm acceptance:m20-7:preflight -- --provider=openai|gemini
  pnpm acceptance:m20-7:live -- --provider=openai|gemini [--smoke] [--publish]

Live billable execution requires:
  OSVA_M20_7_LIVE=1
  OSVA_M20_7_LIVE_EXECUTE=1
  OSVA_M20_7_ISOLATED=1
  OSVA_M20_7_MAX_COST_USD_MICROS=<positive micro-USD cap>
  Provider API key in env (never commit)

Artifacts: artifacts/m20-7/acceptance-results.json (gitignored)
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

function printPreflightSummary(preflight, options) {
  console.log("M20.7 live preflight");
  console.log(`  Environment: ${process.env.CI === "true" ? "CI" : "local"}`);
  console.log(`  Provider: ${preflight.ok ? preflight.provider : "blocked"}`);
  console.log(
    `  Generation model: ${preflight.ok ? preflight.modelId : "n/a"}`,
  );
  if (preflight.ok) {
    const b = preflight.budgets;
    console.log(`  Max builder requests: ${b.maxBuilderRequests}`);
    console.log(`  Max provider invocations: ${b.maxProviderInvocations}`);
    console.log(
      `  Max output tokens / attempt: ${b.maxOutputTokensPerAttempt}`,
    );
    console.log(
      `  Max estimated spend (micro-USD): ${b.maxEstimatedCostUsdMicros}`,
    );
    console.log(
      `  Pricing version: ${MODEL_PRICING_VERSION} (${MODEL_PRICING_RATE_SOURCE})`,
    );
    console.log(
      `  Smoke scenarios: ${options.smoke ? 2 : "operator-selected"}`,
    );
    console.log(
      `  Publication enabled: ${options.publish ? "yes" : "no (default)"}`,
    );
  } else {
    console.log(`  Blocked: ${preflight.reason}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.command === "deterministic") {
    const det = spawnSync(
      process.execPath,
      ["scripts/acceptance/m20-6/run.mjs"],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          ...(options.smoke ? { OSVA_M20_6_SMOKE: "1" } : {}),
        },
      },
    );
    process.exit(det.status ?? 1);
  }

  const env = {
    ...process.env,
    OSVA_M20_7_SMOKE: options.smoke ? "1" : process.env.OSVA_M20_7_SMOKE,
    OSVA_M20_7_LIVE_PROVIDER:
      options.provider ?? process.env.OSVA_M20_7_LIVE_PROVIDER,
    OSVA_M20_7_PUBLICATION: options.publish ? "1" : "0",
  };

  if (options.command === "preflight") {
    env.OSVA_M20_7_LIVE = "1";
    env.OSVA_M20_7_ISOLATED =
      env.OSVA_M20_7_ISOLATED ?? (env.CI === "true" ? undefined : "1");
    const preflight = evaluateLivePreflight(env, {
      provider: options.provider,
      smoke: options.smoke,
    });
    printPreflightSummary(preflight, options);
    if (!preflight.ok) {
      process.exit(2);
    }
    await writeAcceptanceArtifacts(REPO_ROOT, {
      mode: "preflight",
      sourceCommit: gitCommit(),
      liveModeRequested: true,
      liveModeAuthorized: true,
      liveProviderCalls: false,
      actualProviderCallsObserved: 0,
      providerIdentityVerified: false,
      blockedPrerequisite: undefined,
      budgets: preflight.budgets,
      liveProvider: preflight.provider,
      generationModel: preflight.modelId,
      notes: "Preflight OK — no provider calls made.",
    });
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

  if (options.command === "regression") {
    const regression = run(
      [
        "--filter",
        "@osva/console",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.integration.config.ts",
        "test/integration/m20-7-builder-regression.integration.test.ts",
      ],
      env,
    );
    process.exit(regression.status ?? 1);
  }

  env.OSVA_M20_7_LIVE = "1";
  env.OSVA_M20_7_ISOLATED = env.OSVA_M20_7_ISOLATED ?? "1";

  const blocked = liveExecuteBlockedReason(env, { provider: options.provider });
  const preflight = evaluateLivePreflight(env, {
    provider: options.provider,
    smoke: options.smoke,
  });

  if (blocked !== undefined) {
    console.warn(`LIVE_EXECUTE_BLOCKED: ${blocked}`);
    await writeAcceptanceArtifacts(REPO_ROOT, {
      mode: "live",
      sourceCommit: gitCommit(),
      liveModeRequested: true,
      liveModeAuthorized: preflight.ok,
      liveProviderCalls: false,
      actualProviderCallsObserved: 0,
      providerIdentityVerified: false,
      blockedPrerequisite: blocked,
      overallStatus: "BLOCKED_PREREQUISITE",
      allScenariosExecuted: false,
      notes: blocked,
    });
    process.exit(blocked === "OSVA_M20_7_LIVE_EXECUTE not set" ? 0 : 2);
  }

  const { config: budget } = loadAndValidateBudgetFromEnv(env, {
    live: true,
    smoke: options.smoke,
  });

  const integration = run(
    [
      "--filter",
      "@osva/console",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "test/integration/m20-7-builder-live.integration.test.ts",
    ],
    {
      ...env,
      OSVA_M20_7_MAX_BUILDER_REQUESTS: String(budget.maxBuilderRequests),
      OSVA_M20_7_MAX_PROVIDER_INVOCATIONS: String(
        budget.maxProviderInvocations,
      ),
      OSVA_M20_7_MAX_OUTPUT_TOKENS: String(budget.maxOutputTokensPerAttempt),
      OSVA_M20_7_MAX_INPUT_TOKENS: String(budget.maxInputTokensPerAttempt),
      OSVA_M20_7_MAX_TOTAL_DURATION_MS: String(budget.maxTotalDurationMs),
    },
  );

  /** @type {Record<string, unknown> | null} */
  let integrationEvidence = null;
  try {
    integrationEvidence = JSON.parse(
      await fs.readFile(
        path.join(REPO_ROOT, "artifacts/m20-7/acceptance-results.json"),
        "utf8",
      ),
    );
  } catch {
    integrationEvidence = null;
  }

  const provenance = createEmptyProvenance();
  if (integrationEvidence !== null) {
    provenance.liveModeRequested =
      integrationEvidence.liveModeRequested === true;
    provenance.liveModeAuthorized =
      integrationEvidence.liveModeAuthorized === true;
    provenance.actualProviderCallsObserved = Number(
      integrationEvidence.actualProviderCallsObserved ?? 0,
    );
    provenance.providerIdentityVerified =
      integrationEvidence.providerIdentityVerified === true;
  }

  const liveProviderCalls = deriveLiveProviderCallsFlag(provenance);

  const payload = {
    mode: "live",
    sourceCommit: gitCommit(),
    ...provenance,
    liveProviderCalls,
    liveProvider: options.provider,
    budgets: budget,
    pricingVersion: MODEL_PRICING_VERSION,
    pricingRateSource: MODEL_PRICING_RATE_SOURCE,
    scenarios: integrationEvidence?.results ?? [],
    scenarioCount: integrationEvidence?.scenarioCount ?? 0,
    allScenariosExecuted: integrationEvidence?.allScenariosExecuted === true,
    overallStatus: integrationEvidence?.overallStatus ?? "ERROR",
    liveExecuteAttempted: integrationEvidence?.liveExecuteAttempted === true,
    notes: integrationEvidence?.notes ?? "Live integration completed.",
  };

  assertLiveReportConsistency(payload);
  await writeAcceptanceArtifacts(REPO_ROOT, payload);

  if (integration.status !== 0) {
    process.exit(integration.status ?? 1);
  }
  if (
    payload.overallStatus === "PASS" &&
    liveProviderCalls !== true &&
    payload.liveExecuteAttempted === true
  ) {
    console.error(
      "Live run claimed success without verified provider provenance.",
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
