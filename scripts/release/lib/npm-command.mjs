import { spawnSync } from "node:child_process";

/**
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {Record<string, string>} [options.env]
 * @param {"pipe" | "inherit"} [options.stdio]
 */
export function runCommand(command, args, options = {}) {
  const useShell =
    options.shell ??
    (process.platform === "win32" &&
      (command === "pnpm" || command === "npm" || command === "turbo"));
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? "pipe",
    shell: useShell,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
