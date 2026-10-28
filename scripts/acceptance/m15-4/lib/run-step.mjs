import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/** @typedef {"PASS" | "FAIL" | "NOT_RUN" | "BLOCKED"} StepStatus */

/**
 * @typedef {object} StepResult
 * @property {string} id
 * @property {string} group
 * @property {string} journey
 * @property {string} title
 * @property {StepStatus} status
 * @property {number} durationMs
 * @property {number | null} exitCode
 * @property {string | undefined} error
 * @property {string} command
 * @property {string} reuseNote
 */

/**
 * @param {readonly string[]} commandArgv
 * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding["env"]} [env]
 * @returns {{ exitCode: number, durationMs: number }}
 */
export function runCommandArgv(commandArgv, env = process.env) {
  const started = performance.now();
  const [executable, ...args] = commandArgv;
  const resolved =
    executable === process.execPath
      ? executable
      : executable.includes("/") || executable.includes("\\")
        ? path.resolve(REPO_ROOT, executable)
        : executable;

  const result = spawnSync(resolved, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell:
      process.platform === "win32" &&
      !executable.includes("/") &&
      !executable.includes("\\") &&
      executable !== process.execPath,
    env,
  });
  return {
    exitCode: result.status ?? 1,
    durationMs: Math.round(performance.now() - started),
  };
}

/**
 * @param {import("./steps.mjs").AcceptanceStep} step
 * @param {{ dockerReady: boolean, skipped: boolean, skipReason?: string }} context
 * @returns {StepResult}
 */
export function executeStep(step, context) {
  const base = {
    id: step.id,
    group: step.group,
    journey: step.journey,
    title: step.title,
    command: step.command,
    reuseNote: step.reuseNote,
    durationMs: 0,
    exitCode: null,
  };

  if (context.skipped) {
    return {
      ...base,
      status: "NOT_RUN",
      error: context.skipReason ?? "Skipped by profile or group filter",
    };
  }

  if (step.requiresDocker && !context.dockerReady) {
    return {
      ...base,
      status: "BLOCKED",
      error:
        "Docker engine unavailable. Run `pnpm verify:docker` for diagnostics, then retry with --profile=integration or --profile=browser.",
    };
  }

  const { exitCode, durationMs } = runCommandArgv(step.commandArgv);
  if (step.id === "rc4-registry-npm" && exitCode === 3) {
    return {
      ...base,
      status: "NOT_RUN",
      durationMs,
      exitCode,
      error: "npm registry check skipped (network or policy)",
    };
  }

  return {
    ...base,
    status: exitCode === 0 ? "PASS" : "FAIL",
    durationMs,
    exitCode,
    error: exitCode === 0 ? undefined : `Exit code ${exitCode}`,
  };
}

export { REPO_ROOT };
