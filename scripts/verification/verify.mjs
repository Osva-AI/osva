import fs from "node:fs/promises";
import path from "node:path";

import {
  affectedPackages,
  changedFiles,
  hasPrettierCrlfBaseline,
  loadWorkspacePackages,
  prettierSupportedChangedFiles,
} from "./changed-files.mjs";
import { cleanGenerated, leftoverBuildOutputs } from "./clean-generated.mjs";
import {
  CI_PYTHON,
  REPO_ROOT,
  envWithPnpm,
  formatCommand,
  formatDuration,
  loadEnvironment,
  printDoctor,
  pythonRuntimeEnv,
  requireModePrereqs,
  runCommand,
  runSpec,
} from "./environment.mjs";

const PYTHON_SDK_ROOT = path.join(REPO_ROOT, "sdks", "python");
const LABEL_WIDTH = 12;

function printUsage() {
  console.log(`Usage: node scripts/verification/verify.mjs <mode>

Modes:
  doctor      Environment diagnostics
  quick       Format changed files, then cached lint/typecheck/unit tests
  ci          Current GitHub verify job (fail-fast, non-mutating)
  python      Current GitHub python-sdk job
  ci:clean    Clean generated outputs, then verify:ci and verify:python
`);
}

function printPhaseResult(label, status, ms) {
  console.log(
    `${label.padEnd(LABEL_WIDTH)} ${status.padEnd(6)} ${formatDuration(ms)}`,
  );
}

function failStage(stage, command, args, code) {
  console.log("");
  console.log(`FAILED STAGE    ${stage}`);
  console.log(`FAILED COMMAND  ${formatCommand(command, args)}`);
  console.log(`EXIT CODE       ${String(code)}`);
  process.exit(code === 0 ? 1 : code);
}

async function runPhase(stage, spec, args, options = {}) {
  const started = Date.now();
  console.log("");
  console.log(`── ${stage} ──`);
  const result = await runSpec(spec, args, options);
  const ms = Date.now() - started;
  if (result.code !== 0) {
    printPhaseResult(stage, "FAIL", ms);
    failStage(stage, spec.command, [...spec.prefixArgs, ...args], result.code);
  }
  printPhaseResult(stage, "PASS", ms);
  return ms;
}

async function runNamed(stage, command, args, options = {}) {
  return runPhase(stage, { command, prefixArgs: [] }, args, options);
}

function pnpmSpec(env) {
  if (!env.pnpm) {
    throw new Error("pnpm is not available.");
  }
  return env.pnpm;
}

async function pnpmEnv(env) {
  return envWithPnpm(env.pnpm);
}

function pythonSpec(env) {
  if (!env.python) {
    throw new Error("Python is not available.");
  }
  return env.python;
}

async function formatChanged(env, write) {
  const files = await prettierSupportedChangedFiles();
  if (files.length === 0) {
    console.log("No changed Prettier-supported files.");
    return 0;
  }
  const args = [
    "exec",
    "prettier",
    write ? "--write" : "--check",
    "--ignore-unknown",
    "--",
    ...files,
  ];
  return runPhase("FORMAT", pnpmSpec(env), args, { env: await pnpmEnv(env) });
}

async function formatCi(env) {
  const skipFull = await hasPrettierCrlfBaseline();
  if (skipFull) {
    console.log("");
    console.log(
      "Full repository format:check skipped: this Windows working tree has CRLF checkouts of tracked LF files (core.autocrlf). Linux CI still runs the full check. Changed files are checked against repository-standard LF.",
    );
    return formatChanged(env, false);
  }
  return runPhase("FORMAT", pnpmSpec(env), ["format:check"], {
    env: await pnpmEnv(env),
  });
}

async function quickTurboArgs(files) {
  const packages = await loadWorkspacePackages();
  const affected = affectedPackages(files, packages);
  if (affected.global) {
    return [];
  }
  if (affected.names.length === 0) {
    return null;
  }
  return affected.names.flatMap((name) => ["--filter", name]);
}

async function gitDiffCheck() {
  const started = Date.now();
  console.log("");
  console.log("── GIT DIFF CHECK ──");
  const unstaged = await runCommand("git", ["diff", "--check"], {
    stdio: "inherit",
  });
  if (unstaged.code !== 0) {
    printPhaseResult("GITDIFF", "FAIL", Date.now() - started);
    failStage("GIT DIFF CHECK", "git", ["diff", "--check"], unstaged.code);
  }
  const staged = await runCommand("git", ["diff", "--cached", "--check"], {
    stdio: "inherit",
  });
  if (staged.code !== 0) {
    printPhaseResult("GITDIFF", "FAIL", Date.now() - started);
    failStage(
      "GIT DIFF CHECK",
      "git",
      ["diff", "--cached", "--check"],
      staged.code,
    );
  }
  const ms = Date.now() - started;
  printPhaseResult("GITDIFF", "PASS", ms);
  return ms;
}

async function pythonPrerequisite(env) {
  const started = Date.now();
  console.log("");
  console.log("── PYTHON RUNTIME PREREQ ──");
  const spec = pythonSpec(env);
  const result = await runSpec(
    spec,
    [
      "-c",
      "import httpx, osva, osva.runtime, osva.runtime.runtime; print('python runtime imports ok')",
    ],
    { stdio: "inherit", env: pythonRuntimeEnv() },
  );
  const ms = Date.now() - started;
  if (result.code !== 0) {
    printPhaseResult("PYPREREQ", "FAIL", ms);
    console.log(
      "Python runtime dependencies required by apps/worker/test/integration/python-sdk-runtime.integration.test.ts are missing.",
    );
    console.log("Install with: python -m pip install -e ./sdks/python");
    failStage(
      "PYTHON RUNTIME PREREQ",
      spec.command,
      [...spec.prefixArgs, "-c", "import httpx, osva, osva.runtime"],
      result.code,
    );
  }
  printPhaseResult("PYPREREQ", "PASS", ms);
  return ms;
}

async function harnessTestFiles() {
  const dir = path.join(REPO_ROOT, "scripts", "verification");
  const entries = await fs.readdir(dir);
  return entries
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => path.join(dir, name))
    .sort();
}

async function runHarnessTests() {
  const files = await harnessTestFiles();
  return runNamed("HARNESS", process.execPath, ["--test", ...files]);
}

async function doctor(env) {
  printDoctor(env);
  const failures = requireModePrereqs("doctor", env);
  if (failures.length > 0) {
    console.log("");
    for (const failure of failures) {
      console.log(`FAIL  ${failure}`);
    }
    process.exit(1);
  }
  console.log("");
  console.log("verify:doctor PASS");
}

async function quick(env) {
  const started = Date.now();
  const files = await changedFiles();
  const formatMs = await formatChanged(env, true);
  const turboArgs = await quickTurboArgs(files);
  let lintMs = 0;
  let typecheckMs = 0;
  let testMs = 0;
  const envVars = await pnpmEnv(env);
  if (turboArgs === null) {
    console.log("");
    console.log(
      "No workspace packages changed; skipping Turbo lint/typecheck/test.",
    );
    testMs += await runHarnessTests();
  } else {
    lintMs = await runPhase(
      "LINT",
      pnpmSpec(env),
      ["exec", "turbo", "run", "lint", ...turboArgs],
      {
        env: envVars,
      },
    );
    typecheckMs = await runPhase(
      "TYPECHECK",
      pnpmSpec(env),
      ["exec", "turbo", "run", "typecheck", ...turboArgs],
      { env: envVars },
    );
    testMs = await runPhase(
      "TEST",
      pnpmSpec(env),
      ["exec", "turbo", "run", "test", ...turboArgs],
      {
        env: envVars,
      },
    );
    testMs += await runHarnessTests();
  }
  console.log("");
  printPhaseResult("FORMAT", "PASS", formatMs);
  printPhaseResult("LINT", turboArgs === null ? "SKIP" : "PASS", lintMs);
  printPhaseResult(
    "TYPECHECK",
    turboArgs === null ? "SKIP" : "PASS",
    typecheckMs,
  );
  printPhaseResult("TEST", "PASS", testMs);
  printPhaseResult("TOTAL", "PASS", Date.now() - started);
  console.log("");
  console.log("verify:quick PASS");
}

async function ci(env) {
  const started = Date.now();
  const envVars = await pnpmEnv(env);
  const formatMs = await formatCi(env);
  const lintMs = await runPhase("LINT", pnpmSpec(env), ["lint"], {
    env: envVars,
  });
  const typecheckMs = await runPhase(
    "TYPECHECK",
    pnpmSpec(env),
    ["typecheck"],
    {
      env: envVars,
    },
  );
  const harnessMs = await runHarnessTests();
  const testMs =
    harnessMs +
    (await runPhase("TEST", pnpmSpec(env), ["test"], { env: envVars }));
  const buildMs = await runPhase("BUILD", pnpmSpec(env), ["build"], {
    env: envVars,
  });
  const prereqMs = await pythonPrerequisite(env);
  const integrationMs = await runPhase(
    "INTEGRATION",
    pnpmSpec(env),
    ["test:integration"],
    {
      env: envVars,
    },
  );
  const gitMs = await gitDiffCheck();
  console.log("");
  printPhaseResult("FORMAT", "PASS", formatMs);
  printPhaseResult("LINT", "PASS", lintMs);
  printPhaseResult("TYPECHECK", "PASS", typecheckMs);
  printPhaseResult("TEST", "PASS", testMs);
  printPhaseResult("BUILD", "PASS", buildMs);
  printPhaseResult("PYPREREQ", "PASS", prereqMs);
  printPhaseResult("INTEGRATION", "PASS", integrationMs);
  printPhaseResult("GITDIFF", "PASS", gitMs);
  printPhaseResult("TOTAL", "PASS", Date.now() - started);
  console.log("");
  console.log("verify:ci PASS");
}

async function python(env) {
  const started = Date.now();
  const pythonCmd = pythonSpec(env);
  const cwd = PYTHON_SDK_ROOT;
  if (env.python?.version && !env.python.version.startsWith(CI_PYTHON)) {
    console.log(`Local Python: ${env.python.version}`);
    console.log(`CI Python: ${CI_PYTHON}`);
  }
  const formatMs = await runPhase(
    "PYFORMAT",
    pythonCmd,
    ["-m", "ruff", "format", "--check", "."],
    {
      cwd,
    },
  );
  const lintMs = await runPhase(
    "PYLINT",
    pythonCmd,
    ["-m", "ruff", "check", "."],
    { cwd },
  );
  const typeMs = await runPhase("PYTYPE", pythonCmd, ["-m", "mypy", "src"], {
    cwd,
  });
  const testMs = await runPhase("PYTEST", pythonCmd, ["-m", "pytest"], { cwd });
  const buildMs = await runPhase("PYBUILD", pythonCmd, ["-m", "build"], {
    cwd,
  });
  const cleanStarted = Date.now();
  const removed = await cleanGenerated(PYTHON_SDK_ROOT);
  const cleanMs = Date.now() - cleanStarted;
  if (removed.length > 0) {
    console.log(`Cleaned Python build artifacts: ${removed.join(", ")}`);
  }
  printPhaseResult("PYCLEAN", "PASS", cleanMs);
  console.log("");
  printPhaseResult("PYFORMAT", "PASS", formatMs);
  printPhaseResult("PYLINT", "PASS", lintMs);
  printPhaseResult("PYTYPE", "PASS", typeMs);
  printPhaseResult("PYTEST", "PASS", testMs);
  printPhaseResult("PYBUILD", "PASS", buildMs);
  printPhaseResult("TOTAL", "PASS", Date.now() - started);
  console.log("");
  console.log("verify:python PASS");
}

async function ensurePythonDevDeps(env) {
  const started = Date.now();
  console.log("");
  console.log("── PYTHON DEPS ──");
  const spec = pythonSpec(env);
  const result = await runSpec(spec, ["-m", "pip", "install", "-e", ".[dev]"], {
    cwd: PYTHON_SDK_ROOT,
  });
  const ms = Date.now() - started;
  if (result.code !== 0) {
    printPhaseResult("PYDEPS", "FAIL", ms);
    failStage(
      "PYTHON DEPS",
      spec.command,
      ["-m", "pip", "install", "-e", ".[dev]"],
      result.code,
    );
  }
  printPhaseResult("PYDEPS", "PASS", ms);
  return ms;
}

async function ciClean(env) {
  const started = Date.now();
  printDoctor(env);
  const envFail = requireModePrereqs("quick", env);
  if (envFail.length > 0) {
    for (const failure of envFail) {
      console.log(`FAIL  ${failure}`);
    }
    process.exit(1);
  }

  const cleanStarted = Date.now();
  console.log("");
  console.log("── CLEAN ──");
  const removed = await cleanGenerated(REPO_ROOT);
  for (const item of removed) {
    console.log(`removed: ${item}`);
  }
  const leftovers = await leftoverBuildOutputs(REPO_ROOT);
  if (leftovers.length > 0) {
    printPhaseResult("CLEAN", "FAIL", Date.now() - cleanStarted);
    console.log("Generated build outputs still present after clean:");
    for (const item of leftovers) {
      console.log(`  ${item}`);
    }
    process.exit(1);
  }
  const cleanMs = Date.now() - cleanStarted;
  printPhaseResult("CLEAN", "PASS", cleanMs);

  const installMs = await runPhase(
    "INSTALL",
    pnpmSpec(env),
    ["install", "--frozen-lockfile"],
    {
      env: await pnpmEnv(env),
    },
  );
  const pyDepsMs = await ensurePythonDevDeps(env);
  const afterInstall = await loadEnvironment();

  await ci(afterInstall);
  await python(afterInstall);

  const finalStarted = Date.now();
  console.log("");
  console.log("── FINAL CLEAN ──");
  const finalRemoved = await cleanGenerated(REPO_ROOT);
  for (const item of finalRemoved) {
    console.log(`removed: ${item}`);
  }
  printPhaseResult("FINALCLEAN", "PASS", Date.now() - finalStarted);

  await gitDiffCheck();
  console.log("");
  console.log("── GIT STATUS ──");
  await runCommand("git", ["status", "--short"], { stdio: "inherit" });

  console.log("");
  printPhaseResult("CLEAN", "PASS", cleanMs);
  printPhaseResult("INSTALL", "PASS", installMs);
  printPhaseResult("PYDEPS", "PASS", pyDepsMs);
  printPhaseResult("TOTAL", "PASS", Date.now() - started);
  console.log("");
  console.log("verify:ci:clean PASS");
}

const mode = process.argv[2];
if (!mode || mode === "--help" || mode === "-h") {
  printUsage();
  process.exit(mode ? 0 : 1);
}

const env = await loadEnvironment();
const prereqFailures = requireModePrereqs(
  mode === "doctor" ? "doctor" : mode,
  env,
);
if (mode !== "doctor" && prereqFailures.length > 0) {
  printDoctor(env);
  console.log("");
  for (const failure of prereqFailures) {
    console.log(`FAIL  ${failure}`);
  }
  process.exit(1);
}

switch (mode) {
  case "doctor":
    await doctor(env);
    break;
  case "quick":
    await quick(env);
    break;
  case "ci":
    await ci(env);
    break;
  case "python":
    await python(env);
    break;
  case "ci:clean":
    await ciClean(env);
    break;
  default:
    printUsage();
    process.exit(1);
}
