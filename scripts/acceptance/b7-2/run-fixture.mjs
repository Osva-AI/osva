#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function printHelp() {
  console.log(`Usage: pnpm acceptance:b7-2:fixture

FIXTURE_BACKED_RUNTIME_ACCEPTANCE using osva-connectors stdio-github-fixture
and the in-repo loopback GitHub mock. No live api.github.com calls.

Optional:
  OSVA_CONNECTORS_ROOT=<osva-connectors checkout>
  OSVA_B7_2_FIXTURE_STDIO_ENTRY=<path to stdio-github-fixture.js>
`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

function defaultConnectorsRoot() {
  const sibling = path.resolve(REPO_ROOT, "..", "osva-connectors");
  return fs.existsSync(sibling) ? sibling : undefined;
}

const connectorsRoot =
  process.env.OSVA_CONNECTORS_ROOT?.trim() || defaultConnectorsRoot();

const EXPLICIT_STDIO_ENTRY_ENV_VARS = [
  "OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY",
  "OSVA_CONNECTOR_TEST_STDIO_ENTRY",
  "OSVA_B7_2_FIXTURE_STDIO_ENTRY",
];

/** @type {NodeJS.ProcessEnv} */
const fixtureEnv = { ...process.env };
if (connectorsRoot !== undefined) {
  fixtureEnv.OSVA_CONNECTORS_ROOT = connectorsRoot;
  for (const name of EXPLICIT_STDIO_ENTRY_ENV_VARS) {
    delete fixtureEnv[name];
  }
}

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
    "test/integration/b7-2-fixture-backed-runtime-acceptance.integration.test.ts",
  ],
  {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: fixtureEnv,
  },
);
process.exit(result.status ?? 1);
