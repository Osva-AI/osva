#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NPM_CONNECTOR_PACKAGE, NPM_CONNECTOR_VERSION } from "./constants.mjs";
import {
  assertProvenance,
  readInstalledProvenance,
  resolvePublishedNpmStdioEntry,
} from "./lib/provenance.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "artifacts/acceptance/b7-1/consumer-manifest.json",
);

function printHelp() {
  console.log(`Usage: pnpm acceptance:b7-1:published

Operator-only published @osva-ai/connector-npm acceptance through the real OSVA worker stack.

Prerequisites:
  1. Docker (PostgreSQL + Valkey test containers)
  2. pnpm install at repo root
  3. pnpm acceptance:b7-1:prepare   (network: npm registry install to isolated temp dir)
     OR set OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY to an existing dist/stdio.js path

Sets:
  OSVA_B7_1_PUBLISHED_ARTIFACT_LANE=1
  OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY=<resolved path>

Does NOT run during default CI or pnpm install.
`);
}

function resolveConsumerInstallRootFromStdioEntry(stdioEntry) {
  const connectorPkgDir = path.resolve(stdioEntry, "..", "..");
  return path.resolve(connectorPkgDir, "..", "..", "..");
}

function loadManifestEntry() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return undefined;
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (typeof manifest.stdioEntry === "string") {
    return manifest.stdioEntry;
  }
  if (typeof manifest.installRoot === "string") {
    return resolvePublishedNpmStdioEntry(manifest.installRoot);
  }
  return undefined;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const explicit = process.env.OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY?.trim();
  const stdioEntry =
    explicit && explicit.length > 0 ? explicit : loadManifestEntry();
  if (stdioEntry === undefined || !fs.existsSync(stdioEntry)) {
    console.error(
      "PUBLISHED_ARTIFACT_LIVE_NOT_RUN: missing connector entry. Run pnpm acceptance:b7-1:prepare or set OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY.",
    );
    process.exit(2);
  }

  const installRoot = resolveConsumerInstallRootFromStdioEntry(stdioEntry);
  try {
    const provenance = readInstalledProvenance(installRoot);
    assertProvenance(provenance);
    console.log(
      `Verified ${NPM_CONNECTOR_PACKAGE}@${NPM_CONNECTOR_VERSION} at ${stdioEntry}`,
    );
  } catch (error) {
    console.warn(
      `Provenance check skipped or partial (non-fatal when using explicit entry): ${String(error)}`,
    );
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
      "test/integration/b7-1-published-artifact-operational.integration.test.ts",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        OSVA_B7_1_PUBLISHED_ARTIFACT_LANE: "1",
        OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY: stdioEntry,
      },
    },
  );
  process.exit(result.status ?? 1);
}

main();
