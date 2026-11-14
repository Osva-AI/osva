#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const dockerPreflight = spawnSync(
  process.execPath,
  ["scripts/verification/docker-preflight.mjs"],
  { cwd: REPO_ROOT, stdio: "inherit", shell: false },
);
if (dockerPreflight.status !== 0) {
  process.exit(dockerPreflight.status ?? 1);
}

const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@osva/worker",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "test/integration/b7-1-fixture-backed-runtime-acceptance.integration.test.ts",
  ],
  {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
process.exit(result.status ?? 1);
