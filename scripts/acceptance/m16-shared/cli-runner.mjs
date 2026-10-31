import { spawnSync } from "node:child_process";

import { redactSecrets } from "../m16-2d/redact.mjs";

/**
 * @param {string} cliBin
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
export function runCli(cliBin, args, env = {}) {
  return spawnSync(process.execPath, [cliBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/**
 * @param {string} cliBin
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
export function runCliOrThrow(cliBin, args, env = {}) {
  const result = runCli(cliBin, args, env);
  if (result.status !== 0) {
    throw new Error(
      `osva ${args.join(" ")} failed: ${redactSecrets(result.stderr || result.stdout || "")}`,
    );
  }
  return result.stdout ?? "";
}
