import { spawnSync } from "node:child_process";

export function dockerCommand() {
  return process.platform === "win32" ? "docker" : "docker";
}

export function runDocker(args, options = {}) {
  const result = spawnSync(dockerCommand(), args, {
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "";
    throw new Error(
      `docker ${args.join(" ")} failed${detail.length > 0 ? `: ${detail}` : ""}`,
    );
  }
  return result;
}

export function runDockerCapture(args, options = {}) {
  const result = spawnSync(dockerCommand(), args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
  });
  if (result.status !== 0) {
    throw new Error(
      `docker ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}
