import fs from "node:fs/promises";
import path from "node:path";

import { committedBranchChangedPaths } from "./committed-branch-paths.mjs";
import { isPrettierPath } from "./changed-files.mjs";
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

const LABEL_WIDTH = 12;

/** Match branch-verify.mjs batching for Windows argv limits */
const PRETTIER_FILE_BATCH_MAX_FILES = process.platform === "win32" ? 12 : 40;
const PRETTIER_FILE_BATCH_MAX_CHARS =
  process.platform === "win32" ? 5_000 : 32_000;

/**
 * @param {readonly string[]} files
 * @returns {string[][]}
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
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ baseRef: string, help: boolean }} */
  const options = {
    baseRef: "origin/main",
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage() {
  console.log(`Usage: pnpm verify:pre-push [-- --base=origin/main]

Read-only branch gate for pre-push: committed merge-base..HEAD paths only.
Fails if the working tree is dirty, Prettier --check fails, or git diff --check fails.
Does not write formatted files.
`);
}

function printPhaseResult(label, status, ms) {
  console.log(
    `${label.padEnd(LABEL_WIDTH)} ${status.padEnd(8)} ${formatDuration(ms)}`,
  );
}

/**
 * @param {string} stage
 * @param {import("./environment.mjs").CommandSpec} pnpmSpec
 * @param {readonly string[]} args
 * @param {number} code
 */
function failStage(stage, pnpmSpec, args, code) {
  console.log("");
  console.log(`FAILED STAGE    ${stage}`);
  console.log(`FAILED COMMAND  ${formatCommand(pnpmSpec.command, args)}`);
  console.log(`EXIT CODE       ${String(code)}`);
  process.exit(code === 0 ? 1 : code);
}

/**
 * @param {readonly string[]} relativePaths
 * @returns {Promise<string[]>}
 */
async function existingRepoFiles(relativePaths) {
  const out = [];
  for (const relative of relativePaths) {
    const absolute = path.join(REPO_ROOT, relative);
    try {
      const stat = await fs.stat(absolute);
      if (stat.isFile()) {
        out.push(relative.split(path.sep).join("/"));
      }
    } catch {
      // deleted in branch
    }
  }
  return out.sort();
}

/**
 * @param {import("./environment.mjs").CommandSpec} pnpmSpec
 * @param {Awaited<ReturnType<typeof loadEnvironment>>} env
 * @param {readonly string[]} files
 */
async function runPrettierCheck(pnpmSpec, env, files) {
  if (files.length === 0) {
    console.log("");
    console.log("── FORMAT CHECK (SKIP) ──");
    console.log(
      "              SKIP       (no prettier-eligible committed files)",
    );
    return;
  }
  const batches = chunkPrettierFiles(files);
  let totalMs = 0;
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    const stage =
      batches.length === 1
        ? "FORMAT CHECK"
        : `FORMAT CHECK (${index + 1}/${batches.length})`;
    const args = [
      "exec",
      "prettier",
      "--check",
      "--ignore-unknown",
      "--",
      ...batch,
    ];
    const started = Date.now();
    console.log("");
    console.log(`── ${stage} ──`);
    const result = await runSpec(pnpmSpec, args, {
      env: await envWithPnpm(pnpmSpec),
    });
    const ms = Date.now() - started;
    totalMs += ms;
    if (result.code !== 0) {
      printPhaseResult(stage, "FAIL", ms);
      failStage(stage, pnpmSpec, args, result.code);
    }
    printPhaseResult(stage, "PASS", ms);
  }
}

async function assertCleanWorkingTree() {
  const started = Date.now();
  console.log("");
  console.log("── WORKING TREE ──");
  const result = await runCommand("git", ["status", "--porcelain"], {
    stdio: "pipe",
    cwd: REPO_ROOT,
  });
  if (result.code !== 0) {
    printPhaseResult("DIRTY CHECK", "FAIL", Date.now() - started);
    console.error(result.stderr.trim());
    process.exit(1);
  }
  const lines = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length > 0) {
    printPhaseResult("DIRTY CHECK", "FAIL", Date.now() - started);
    console.error(
      "Working tree is not clean. Stash or commit before push, or verification may not match the commit being pushed:",
    );
    for (const line of lines) {
      console.error(`  ${line}`);
    }
    process.exit(1);
  }
  printPhaseResult("DIRTY CHECK", "PASS", Date.now() - started);
}

/**
 * @param {string} mergeBaseSha
 * @param {string} headRef
 */
async function gitDiffCheckRange(mergeBaseSha, headRef) {
  const started = Date.now();
  console.log("");
  console.log("── GIT DIFF CHECK (COMMITTED) ──");
  const result = await runCommand(
    "git",
    ["diff", "--check", `${mergeBaseSha}..${headRef}`],
    { stdio: "inherit", cwd: REPO_ROOT },
  );
  if (result.code !== 0) {
    printPhaseResult("GITDIFF", "FAIL", Date.now() - started);
    process.exit(result.code);
  }
  printPhaseResult("GITDIFF", "PASS", Date.now() - started);
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

  const inventory = await committedBranchChangedPaths({
    baseRef: cli.baseRef,
    headRef: "HEAD",
    gitCwd: REPO_ROOT,
  });
  if (!inventory.ok) {
    console.error(inventory.message);
    process.exit(1);
  }

  console.log("");
  console.log("── COMMITTED BRANCH INVENTORY ──");
  console.log(`Base:       ${inventory.baseRef} (${inventory.baseSha})`);
  console.log(`Merge-base: ${inventory.mergeBaseSha}`);
  console.log(
    `Changed:    ${String(inventory.paths.length)} path(s) committed`,
  );

  await assertCleanWorkingTree();

  const existing = await existingRepoFiles(inventory.paths);
  const prettierTargets = existing.filter((f) => isPrettierPath(f));
  await runPrettierCheck(pnpmSpec, env, prettierTargets);

  await gitDiffCheckRange(inventory.mergeBaseSha, "HEAD");

  console.log("");
  console.log("verify:pre-push PASS (read-only)");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
