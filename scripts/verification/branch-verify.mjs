import fs from "node:fs/promises";
import path from "node:path";

import { branchChangedPaths } from "./branch-git.mjs";
import { buildVerificationPlan } from "./branch-impact.mjs";
import { changedFiles, isPrettierPath } from "./changed-files.mjs";
import {
  envWithPnpm,
  formatCommand,
  formatDuration,
  loadEnvironment,
  printDoctor,
  requireModePrereqs,
  runCommand,
  runSpec,
  REPO_ROOT,
} from "./environment.mjs";
import { probeDockerEngine } from "./docker-preflight.mjs";

const REPORT_DIR = path.join(REPO_ROOT, "artifacts", "verification");
const REPORT_PATH = path.join(REPORT_DIR, "branch-verification.json");
const LABEL_WIDTH = 12;

/** @typedef {"PASS" | "FAIL" | "NOT RUN" | "SKIP"} CheckStatus */

/**
 * @typedef {object} CheckRecord
 * @property {string} id
 * @property {string} stage
 * @property {CheckStatus} status
 * @property {number} durationMs
 * @property {string} command
 * @property {string} [detail]
 * @property {boolean} [cached]
 */

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ baseRef: string, profile: "fast" | "integration", help: boolean }} */
  const options = {
    baseRef: "origin/main",
    profile: "fast",
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--base=")) {
      options.baseRef = arg.slice("--base=".length);
      continue;
    }
    if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length);
      if (value === "integration" || value === "fast") {
        options.profile = value;
      } else {
        throw new Error(`Unknown profile "${value}". Use fast or integration.`);
      }
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage() {
  console.log(`Usage: pnpm verify:branch [-- --base=origin/main] [--profile=fast|integration]

Canonical branch-readiness verification (merge-base aware, incremental).

Profiles:
  fast (default)   Changed-file format/lint/typecheck/build/tests, obligations reported
  integration      Also runs impacted integration/browser obligations when practical
`);
}

function printPhaseResult(label, status, ms) {
  console.log(
    `${label.padEnd(LABEL_WIDTH)} ${status.padEnd(8)} ${formatDuration(ms)}`,
  );
}

/**
 * @param {string} stage
 * @param {string} command
 * @param {readonly string[]} args
 * @param {number} code
 */
function failStage(stage, command, args, code) {
  console.log("");
  console.log(`FAILED STAGE    ${stage}`);
  console.log(`FAILED COMMAND  ${formatCommand(command, args)}`);
  console.log(`EXIT CODE       ${String(code)}`);
  process.exit(code === 0 ? 1 : code);
}

/**
 * @param {import("./environment.mjs").CommandSpec} spec
 */
async function pnpmEnvFromSpec(spec) {
  return envWithPnpm(spec);
}

/** Windows CreateProcess argv limits — mirror verify.mjs */
const PRETTIER_FILE_BATCH_MAX_FILES = process.platform === "win32" ? 12 : 40;
const PRETTIER_FILE_BATCH_MAX_CHARS =
  process.platform === "win32" ? 5_000 : 32_000;

/**
 * @param {readonly string[]} files
 */
function chunkPrettierFiles(files) {
  /** @type {string[][]} */
  const batches = [];
  /** @type {string[]} */
  let batch = [];
  let chars = 0;
  for (const file of files) {
    const added = file.length + 1;
    if (
      batch.length > 0 &&
      (batch.length >= PRETTIER_FILE_BATCH_MAX_FILES ||
        chars + added > PRETTIER_FILE_BATCH_MAX_CHARS)
    ) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(file);
    chars += added;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

/**
 * @param {readonly string[]} paths
 */
async function existingPrettierPaths(paths) {
  const existing = await changedFiles();
  const existingSet = new Set(existing);
  return paths.filter((file) => existingSet.has(file) && isPrettierPath(file));
}

/**
 * @param {import("./environment.mjs").CommandSpec} pnpmSpec
 * @param {Awaited<ReturnType<typeof loadEnvironment>>} env
 * @param {boolean} write
 * @param {readonly string[]} files
 * @param {CheckRecord[]} records
 */
async function runPrettier(pnpmSpec, env, write, files, records) {
  if (files.length === 0) {
    records.push({
      id: "format",
      stage: "FORMAT",
      status: "SKIP",
      durationMs: 0,
      command: "(no prettier files)",
    });
    return;
  }
  const modeFlag = write ? "--write" : "--check";
  const batches = chunkPrettierFiles(files);
  let totalMs = 0;
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    const stage =
      batches.length === 1
        ? write
          ? "FORMAT WRITE"
          : "FORMAT CHECK"
        : `${write ? "FORMAT WRITE" : "FORMAT CHECK"} (${index + 1}/${batches.length})`;
    const args = [
      "exec",
      "prettier",
      modeFlag,
      "--ignore-unknown",
      "--",
      ...batch,
    ];
    const started = Date.now();
    console.log("");
    console.log(`── ${stage} ──`);
    const result = await runSpec(pnpmSpec, args, {
      env: await pnpmEnvFromSpec(pnpmSpec),
    });
    const ms = Date.now() - started;
    totalMs += ms;
    if (result.code !== 0) {
      printPhaseResult(stage, "FAIL", ms);
      records.push({
        id: write ? "format-write" : "format-check",
        stage,
        status: "FAIL",
        durationMs: ms,
        command: formatCommand(pnpmSpec.command, [
          ...pnpmSpec.prefixArgs,
          ...args,
        ]),
      });
      failStage(stage, pnpmSpec.command, args, result.code);
    }
    printPhaseResult(stage, "PASS", ms);
  }
  records.push({
    id: write ? "format-write" : "format-check",
    stage: write ? "FORMAT WRITE" : "FORMAT CHECK",
    status: "PASS",
    durationMs: totalMs,
    command: `prettier ${modeFlag} (${String(files.length)} files)`,
  });
}

async function gitDiffCheck(records) {
  const started = Date.now();
  console.log("");
  console.log("── GIT DIFF CHECK ──");
  const unstaged = await runCommand("git", ["diff", "--check"], {
    stdio: "inherit",
  });
  if (unstaged.code !== 0) {
    printPhaseResult("GITDIFF", "FAIL", Date.now() - started);
    records.push({
      id: "git-diff-check",
      stage: "GIT DIFF CHECK",
      status: "FAIL",
      durationMs: Date.now() - started,
      command: "git diff --check",
    });
    failStage("GIT DIFF CHECK", "git", ["diff", "--check"], unstaged.code);
  }
  const staged = await runCommand("git", ["diff", "--cached", "--check"], {
    stdio: "inherit",
  });
  if (staged.code !== 0) {
    printPhaseResult("GITDIFF", "FAIL", Date.now() - started);
    records.push({
      id: "git-diff-check",
      stage: "GIT DIFF CHECK",
      status: "FAIL",
      durationMs: Date.now() - started,
      command: "git diff --cached --check",
    });
    failStage(
      "GIT DIFF CHECK",
      "git",
      ["diff", "--cached", "--check"],
      staged.code,
    );
  }
  const ms = Date.now() - started;
  printPhaseResult("GITDIFF", "PASS", ms);
  records.push({
    id: "git-diff-check",
    stage: "GIT DIFF CHECK",
    status: "PASS",
    durationMs: ms,
    command: "git diff --check && git diff --cached --check",
  });
}

/**
 * @param {import("./environment.mjs").CommandSpec} pnpmSpec
 * @param {Awaited<ReturnType<typeof loadEnvironment>>} env
 * @param {string} stage
 * @param {readonly string[]} turboArgs
 * @param {string} task
 * @param {CheckRecord[]} records
 */
async function runTurboTask(pnpmSpec, env, stage, turboArgs, task, records) {
  const args = ["exec", "turbo", "run", task, ...turboArgs];
  const started = Date.now();
  console.log("");
  console.log(`── ${stage} ──`);
  const result = await runSpec(pnpmSpec, args, {
    env: await pnpmEnvFromSpec(pnpmSpec),
  });
  const ms = Date.now() - started;
  if (result.code !== 0) {
    printPhaseResult(stage, "FAIL", ms);
    records.push({
      id: task,
      stage,
      status: "FAIL",
      durationMs: ms,
      command: formatCommand(pnpmSpec.command, [
        ...pnpmSpec.prefixArgs,
        ...args,
      ]),
    });
    failStage(stage, pnpmSpec.command, args, result.code);
  }
  printPhaseResult(stage, "PASS", ms);
  records.push({
    id: task,
    stage,
    status: "PASS",
    durationMs: ms,
    command: formatCommand(pnpmSpec.command, [...pnpmSpec.prefixArgs, ...args]),
  });
}

/**
 * @param {import("./environment.mjs").CommandSpec} pnpmSpec
 * @param {import("./branch-impact.mjs").TargetedUnitTest} target
 * @param {CheckRecord[]} records
 */
async function runTargetedTests(pnpmSpec, target, records) {
  const args = [
    "--filter",
    target.packageName,
    "exec",
    "vitest",
    "run",
    ...target.relativeTestFiles,
  ];
  const stage = `TEST ${target.label}`;
  const started = Date.now();
  console.log("");
  console.log(`── ${stage} ──`);
  const result = await runSpec(pnpmSpec, args, {
    env: await pnpmEnvFromSpec(pnpmSpec),
  });
  const ms = Date.now() - started;
  if (result.code !== 0) {
    printPhaseResult(stage, "FAIL", ms);
    records.push({
      id: `target:${target.label}`,
      stage,
      status: "FAIL",
      durationMs: ms,
      command: formatCommand(pnpmSpec.command, [
        ...pnpmSpec.prefixArgs,
        ...args,
      ]),
    });
    failStage(stage, pnpmSpec.command, args, result.code);
  }
  printPhaseResult(stage, "PASS", ms);
  records.push({
    id: `target:${target.label}`,
    stage,
    status: "PASS",
    durationMs: ms,
    command: formatCommand(pnpmSpec.command, [...pnpmSpec.prefixArgs, ...args]),
  });
}

async function runHarnessTests(records) {
  const dir = path.join(REPO_ROOT, "scripts", "verification");
  const entries = await fs.readdir(dir);
  const files = entries
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => path.join(dir, name))
    .sort();
  const stage = "HARNESS";
  const started = Date.now();
  console.log("");
  console.log(`── ${stage} ──`);
  const result = await runCommand(process.execPath, ["--test", ...files], {
    stdio: "inherit",
  });
  const ms = Date.now() - started;
  if (result.code !== 0) {
    printPhaseResult(stage, "FAIL", ms);
    records.push({
      id: "harness",
      stage,
      status: "FAIL",
      durationMs: ms,
      command: `node --test scripts/verification/*.test.mjs`,
    });
    failStage(stage, process.execPath, ["--test", "..."], result.code);
  }
  printPhaseResult(stage, "PASS", ms);
  records.push({
    id: "harness",
    stage,
    status: "PASS",
    durationMs: ms,
    command: `node --test scripts/verification/*.test.mjs`,
  });
}

/**
 * @param {string} stage
 * @param {readonly string[]} argv
 * @param {CheckRecord[]} records
 * @param {string} [recordId]
 */
async function runArgvCommand(stage, argv, records, recordId) {
  const [command, ...args] = argv;
  const started = Date.now();
  console.log("");
  console.log(`── ${stage} ──`);
  const result = await runCommand(command, args, { stdio: "inherit" });
  const ms = Date.now() - started;
  const formatted = formatCommand(command, args);
  if (result.code !== 0) {
    printPhaseResult(stage, "FAIL", ms);
    records.push({
      id: recordId ?? stage,
      stage,
      status: "FAIL",
      durationMs: ms,
      command: formatted,
    });
    failStage(stage, command, args, result.code);
  }
  printPhaseResult(stage, "PASS", ms);
  records.push({
    id: recordId ?? stage,
    stage,
    status: "PASS",
    durationMs: ms,
    command: formatted,
  });
}

/**
 * @param {Awaited<ReturnType<typeof loadEnvironment>>} env
 */
async function dockerAvailable(env) {
  if (!env.docker?.source) {
    return false;
  }
  const spec = { command: env.docker.source, prefixArgs: [] };
  const probe = await probeDockerEngine(spec, runSpec);
  return probe.engine === "running";
}

/**
 * @param {object} report
 */
async function writeReport(report) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    REPORT_PATH,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

/**
 * @param {CheckRecord[]} records
 * @param {import("./branch-impact.mjs").IntegrationObligation[]} obligations
 * @param {boolean} failed
 * @param {boolean} hasUnknown
 */
function classifyReadiness(records, obligations, failed, hasUnknown) {
  if (failed || hasUnknown) {
    return "FAILED";
  }
  const pending = obligations.filter(
    (item) =>
      !records.some(
        (record) =>
          record.id === `obligation:${item.id}` && record.status === "PASS",
      ),
  );
  if (pending.length > 0) {
    return "BLOCKED";
  }
  return "LOCAL_PASS";
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printUsage();
    process.exit(0);
  }

  const env = await loadEnvironment();
  const prereqFailures = requireModePrereqs("quick", env);
  if (prereqFailures.length > 0) {
    printDoctor(env);
    console.log("");
    for (const failure of prereqFailures) {
      console.log(`FAIL  ${failure}`);
    }
    process.exit(1);
  }

  if (!env.pnpm) {
    console.error("pnpm is not available.");
    process.exit(1);
  }
  const pnpmSpec = env.pnpm;

  const started = Date.now();
  /** @type {CheckRecord[]} */
  const records = [];

  const inventory = await branchChangedPaths({ baseRef: cli.baseRef });
  if (!inventory.ok) {
    console.error(inventory.message);
    process.exit(1);
  }

  console.log("");
  console.log("── IMPACT INVENTORY ──");
  console.log(`Base:       ${inventory.baseRef} (${inventory.baseSha})`);
  console.log(`Merge-base: ${inventory.mergeBaseSha}`);
  console.log(`Changed:    ${String(inventory.paths.length)} path(s)`);

  if (inventory.paths.length === 0) {
    console.log("No changed files relative to merge-base and working tree.");
    await gitDiffCheck(records);
    const report = {
      baseRef: inventory.baseRef,
      baseSha: inventory.baseSha,
      mergeBaseSha: inventory.mergeBaseSha,
      changedFileCount: 0,
      affectedPackages: [],
      impactedConsumers: [],
      checks: records,
      obligations: [],
      readiness: "LOCAL_PASS",
      durationMs: Date.now() - started,
    };
    await writeReport(report);
    console.log("");
    console.log("verify:branch LOCAL_PASS (empty changeset)");
    process.exit(0);
  }

  const plan = await buildVerificationPlan(inventory.paths, {
    profile: cli.profile,
  });

  if (plan.impactSummary.length > 0) {
    for (const line of plan.impactSummary) {
      console.log(`  • ${line}`);
    }
  } else {
    console.log("  • package-ownership only");
  }
  if (plan.turboPackageNames.length > 0) {
    console.log(`Packages:   ${plan.turboPackageNames.join(", ")}`);
  }
  if (plan.consumerPackageNames.length > 0) {
    console.log(`Consumers:  ${plan.consumerPackageNames.join(", ")}`);
  }
  if (plan.obligations.length > 0) {
    console.log("Obligations:");
    for (const item of plan.obligations) {
      console.log(`  • ${item.id}: ${item.label}`);
    }
  }

  if (plan.unknownSourcePaths.length > 0) {
    console.log("");
    console.log("UNKNOWN SOURCE PATHS (no impact rule matched):");
    for (const file of plan.unknownSourcePaths) {
      console.log(`  ${file}`);
    }
    records.push({
      id: "unknown-source",
      stage: "IMPACT",
      status: "FAIL",
      durationMs: 0,
      command: "(impact mapping)",
      detail: plan.unknownSourcePaths.join(", "),
    });
    await writeReport({
      baseRef: inventory.baseRef,
      baseSha: inventory.baseSha,
      mergeBaseSha: inventory.mergeBaseSha,
      changedFileCount: inventory.paths.length,
      affectedPackages: plan.turboPackageNames,
      impactedConsumers: plan.consumerPackageNames,
      checks: records,
      obligations: plan.obligations.map((item) => ({
        ...item,
        status: "NOT RUN",
      })),
      readiness: "FAILED",
      durationMs: Date.now() - started,
    });
    console.log("");
    console.log(
      "verify:branch FAILED (unknown source changes — extend branch-impact.mjs)",
    );
    process.exit(1);
  }

  let prettierTargets = await existingPrettierPaths(inventory.paths);
  await runPrettier(pnpmSpec, env, true, prettierTargets, records);
  prettierTargets = await existingPrettierPaths(inventory.paths);
  await runPrettier(pnpmSpec, env, false, prettierTargets, records);

  const turboArgs = plan.globalTurbo
    ? []
    : plan.turboPackageNames.flatMap((name) => ["--filter", name]);

  if (plan.globalTurbo) {
    console.log("");
    console.log(
      "Root workspace configuration changed; running full cached Turbo lint/typecheck/test/build.",
    );
    await runTurboTask(pnpmSpec, env, "LINT", [], "lint", records);
    await runTurboTask(pnpmSpec, env, "TYPECHECK", [], "typecheck", records);
    await runTurboTask(pnpmSpec, env, "TEST", [], "test", records);
    await runTurboTask(pnpmSpec, env, "BUILD", [], "build", records);
  } else if (turboArgs.length === 0) {
    console.log("");
    console.log("No workspace packages affected; skipping Turbo tasks.");
  } else {
    await runTurboTask(pnpmSpec, env, "LINT", turboArgs, "lint", records);
    await runTurboTask(
      pnpmSpec,
      env,
      "TYPECHECK",
      turboArgs,
      "typecheck",
      records,
    );
    await runTurboTask(pnpmSpec, env, "BUILD", turboArgs, "build", records);
    await runTurboTask(pnpmSpec, env, "TEST", turboArgs, "test", records);
  }

  for (const target of plan.targetedUnitTests) {
    await runTargetedTests(pnpmSpec, target, records);
  }

  if (plan.docsLinkCheck) {
    await runArgvCommand(
      "DOCS LINK CHECK",
      [process.execPath, "scripts/release/docs-link-check.mjs"],
      records,
    );
  }

  if (plan.migrationIntegrity) {
    await runArgvCommand(
      "MIGRATION INTEGRITY",
      ["pnpm", "db:migrations:integrity"],
      records,
    );
  }

  if (plan.runHarnessTests) {
    await runHarnessTests(records);
  }

  const dockerOk = await dockerAvailable(env);

  for (const obligation of plan.obligations) {
    const recordId = `obligation:${obligation.id}`;
    if (cli.profile !== "integration" || !obligation.runInIntegrationProfile) {
      records.push({
        id: recordId,
        stage: obligation.label,
        status: "NOT RUN",
        durationMs: 0,
        command: obligation.command,
        detail: obligation.reason,
      });
      continue;
    }
    if (obligation.requiresDocker && !dockerOk) {
      records.push({
        id: recordId,
        stage: obligation.label,
        status: "NOT RUN",
        durationMs: 0,
        command: obligation.command,
        detail:
          "Docker engine unavailable — start Docker or use CI for this obligation.",
      });
      continue;
    }
    await runArgvCommand(
      obligation.label,
      obligation.commandArgv,
      records,
      recordId,
    );
  }

  await gitDiffCheck(records);

  const readiness = classifyReadiness(records, plan.obligations, false, false);
  const report = {
    baseRef: inventory.baseRef,
    baseSha: inventory.baseSha,
    mergeBaseSha: inventory.mergeBaseSha,
    changedFileCount: inventory.paths.length,
    affectedPackages: plan.globalTurbo ? ["*"] : plan.turboPackageNames,
    impactedConsumers: plan.consumerPackageNames,
    profile: cli.profile,
    checks: records,
    obligations: plan.obligations.map((item) => {
      const record = records.find(
        (entry) => entry.id === `obligation:${item.id}`,
      );
      return {
        ...item,
        status: record?.status ?? "NOT RUN",
      };
    }),
    readiness,
    durationMs: Date.now() - started,
    reportPath: path.relative(REPO_ROOT, REPORT_PATH).split(path.sep).join("/"),
  };
  await writeReport(report);

  console.log("");
  console.log("── SUMMARY ──");
  for (const record of records) {
    printPhaseResult(record.stage, record.status, record.durationMs);
  }
  console.log("");
  console.log(`Readiness: ${readiness}`);
  console.log(`Report:    ${report.reportPath}`);
  if (readiness === "BLOCKED") {
    console.log("");
    console.log(
      "Required integration or browser suites were NOT RUN. Re-run with:",
    );
    console.log("  pnpm verify:branch -- --profile=integration");
    console.log("");
    console.log("This is not an unconditional READY TO MERGE.");
  }
  if (readiness === "LOCAL_PASS") {
    console.log("");
    console.log("verify:branch LOCAL_PASS");
  } else if (readiness === "BLOCKED") {
    console.log("");
    console.log(
      "verify:branch BLOCKED (local checks passed; obligations remain)",
    );
    process.exit(2);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
