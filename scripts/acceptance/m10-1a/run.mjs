#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function printHelp() {
  console.log(`Usage: pnpm acceptance:m10-1a

Runs the Hello Agent golden path against a live OSVA stack.
Requires OSVA_BASE_URL, OSVA_API_KEY, OSVA_WORKSPACE_ID, and either:
  - OSVA_HELLO_TRUSTED_RUNTIME_MODE=host with OSVA_TRUSTED_RUNTIME_ROOT, or
  - OSVA_HELLO_TRUSTED_RUNTIME_MODE=compose with deploy/compose worker volume.

This wrapper does not start infrastructure. Use pnpm infra:up / deploy/compose first.
`);
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const started = performance.now();
  const build = spawnSync(
    "pnpm",
    ["--filter", "@osva/example-hello-agent", "build"],
    { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  const run = spawnSync("pnpm", ["example:hello"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  const totalMs = performance.now() - started;
  console.log("");
  console.log(
    JSON.stringify(
      {
        acceptance: "m10-1a",
        exitCode: run.status ?? 1,
        wrapperTotalMs: Math.round(totalMs),
      },
      null,
      2,
    ),
  );
  process.exit(run.status ?? 1);
}

main();
