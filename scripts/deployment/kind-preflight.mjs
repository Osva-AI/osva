import { spawnSync } from "node:child_process";

/** Client-only check: must not require a live cluster before kind create. */
export const KUBECTL_PREFLIGHT_ARGS = ["version", "--client"];

export function requireBinary(name, args = ["version"]) {
  const check = spawnSync(name, args, { encoding: "utf8" });
  if (check.error?.code === "ENOENT") {
    throw new Error(`${name} is required for kind acceptance`);
  }
  if (check.status !== 0) {
    throw new Error(
      `${name} preflight failed:\n${check.stderr || check.stdout}`,
    );
  }
}
