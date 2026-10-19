#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function parseArgs(argv) {
  const options = { withBrowser: false, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
    if (arg === "--with-browser") {
      options.withBrowser = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm acceptance:m12-3 [--with-browser]

Runs M12.3 cross-capability acceptance against a disposable real stack:
  - Docker-backed PostgreSQL and Valkey (via integration harness)
  - Web + worker + Console BFF on loopback (Option A)
  - Deterministic fake OpenAI-compatible model service
  - Deterministic fake Streamable HTTP MCP server
  - Human Better Auth session through Console BFF

Prerequisites:
  - Docker available for PostgreSQL/Valkey test containers
  - pnpm install (includes Playwright when using --with-browser)
  - For browser sub-scenario: pnpm exec playwright install chromium

Optional operator profiles (not run by default):
  - pnpm acceptance:m12-3 -- --profile=ollama  (documented in scripts/acceptance/m12-3/README.md)
`);
}

function runPnpm(args, env = process.env) {
  return spawnSync("pnpm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const started = performance.now();
  const dockerPreflight = spawnSync(
    "node",
    ["scripts/verification/docker-preflight.mjs"],
    { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (dockerPreflight.status !== 0) {
    process.exit(dockerPreflight.status ?? 1);
  }

  const build = runPnpm([
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=@osva/console",
    "--filter=@osva/web",
    "--filter=@osva/worker",
    "--filter=@osva/db",
    "--filter=@osva/adapters-bullmq",
    "--filter=@osva/adapters-mcp-client",
    "--filter=@osva/adapters-runtime-typescript",
  ]);
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  const integrationArgs = [
    "--filter",
    "@osva/console",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "test/integration/m12-3-cross-capability.integration.test.ts",
  ];
  if (options.withBrowser) {
    integrationArgs.push("test/integration/m12-3-browser.integration.test.ts");
    const browsers = runPnpm(["exec", "playwright", "install", "chromium"]);
    if (browsers.status !== 0) {
      process.exit(browsers.status ?? 1);
    }
  }

  const vitest = runPnpm(integrationArgs);
  const totalMs = performance.now() - started;
  console.log("");
  console.log(
    JSON.stringify(
      {
        acceptance: "m12-3",
        withBrowser: options.withBrowser,
        exitCode: vitest.status ?? 1,
        wrapperTotalMs: Math.round(totalMs),
      },
      null,
      2,
    ),
  );
  process.exit(vitest.status ?? 1);
}

main();
