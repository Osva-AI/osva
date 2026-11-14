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
  console.log(`Usage: pnpm acceptance:b7-3:fixture

FIXTURE_BACKED_RUNTIME_ACCEPTANCE using loopback Shopify + GA4 mocks and
in-repo stdio test fixtures. No live Shopify Admin API or Google Analytics calls.

Prerequisites:
  pnpm --filter @osva/tool-gateway build:test-stdio-fixtures
  (osva-connectors) pnpm --filter @osva-ai/connector-shopify build
  (osva-connectors) pnpm --filter @osva-ai/connector-ga4 build

Optional:
  OSVA_CONNECTORS_ROOT=<osva-connectors checkout>
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

const fixtureBuild = spawnSync(
  "pnpm",
  ["--filter", "@osva/tool-gateway", "build:test-stdio-fixtures"],
  { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" },
);
if (fixtureBuild.status !== 0) {
  process.exit(fixtureBuild.status ?? 1);
}

if (connectorsRoot !== undefined) {
  for (const filter of [
    "@osva-ai/connector-shopify",
    "@osva-ai/connector-ga4",
  ]) {
    const build = spawnSync("pnpm", ["--filter", filter, "build"], {
      cwd: connectorsRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (build.status !== 0) {
      console.warn(
        `Warning: could not build ${filter} in ${connectorsRoot}. Ensure connector dist exists.`,
      );
    }
  }
}

/** @type {NodeJS.ProcessEnv} */
const fixtureEnv = { ...process.env };
if (connectorsRoot !== undefined) {
  fixtureEnv.OSVA_CONNECTORS_ROOT = connectorsRoot;
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
    "test/integration/b7-3-fixture-backed-runtime-acceptance.integration.test.ts",
  ],
  {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: fixtureEnv,
  },
);
process.exit(result.status ?? 1);
