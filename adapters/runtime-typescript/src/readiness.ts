import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveTrustedRuntimeRoot } from "./trusted-path.js";

export interface TrustedTypeScriptRuntimeConfig {
  readonly trustedRuntimeRoot: string;
}

export async function assertTrustedTypeScriptRuntimeReady(
  config: TrustedTypeScriptRuntimeConfig,
): Promise<{
  readonly trustedRuntimeRoot: string;
  readonly childRunnerPath: string;
}> {
  const trimmed = config.trustedRuntimeRoot?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error("OSVA_TRUSTED_RUNTIME_ROOT is required.");
  }

  const trustedRuntimeRoot = await resolveTrustedRuntimeRoot(trimmed);
  const childRunnerPath = resolveChildRunnerPath();
  if (!fs.existsSync(childRunnerPath)) {
    throw new Error("Trusted TypeScript child runner was not found.");
  }

  return { trustedRuntimeRoot, childRunnerPath };
}

export function resolveChildRunnerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "child-runner.js"),
    path.join(here, "..", "dist", "child-runner.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Trusted TypeScript child runner was not found.");
}

/**
 * Defense-in-depth Node permission flags. This is not a hostile-code sandbox.
 * tsx/esbuild is not used; the child runner is compiled JavaScript so native
 * addons are not required.
 */
export function childPermissionExecArgv(
  trustedRuntimeRoot: string,
  childRunnerPath: string,
): string[] {
  const runnerDir = path.dirname(childRunnerPath);
  return [
    "--permission",
    `--allow-fs-read=${runnerDir}`,
    `--allow-fs-read=${trustedRuntimeRoot}`,
  ];
}
