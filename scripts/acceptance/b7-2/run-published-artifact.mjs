#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GITHUB_CONNECTOR_PACKAGE,
  GITHUB_CONNECTOR_VERSION,
} from "./constants.mjs";
import {
  assertOperatorPatConfigured,
  assertProvenance,
  readInstalledProvenance,
  resolveConsumerInstallRootFromStdioEntry,
  resolvePublishedGithubStdioEntry,
} from "./lib/provenance.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "artifacts/acceptance/b7-2/consumer-manifest.json",
);

function printHelp() {
  console.log(`Usage: pnpm acceptance:b7-2:published

Operator-only published @osva-ai/connector-github read-only acceptance.

Prerequisites:
  1. Docker (PostgreSQL + Valkey test containers)
  2. pnpm install
  3. pnpm acceptance:b7-2:prepare
  4. Fine-grained read-only GitHub PAT in env var B7_2_GITHUB_OPERATOR_PAT
     (Metadata read on Osva-AI/osva only — never pass via CLI/URLs)

Never invokes github.issue.create or github.issue.comment.create.
`);
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
    return resolvePublishedGithubStdioEntry(manifest.installRoot);
  }
  return undefined;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  try {
    assertOperatorPatConfigured();
  } catch (error) {
    console.error(String(error));
    console.error(
      "PUBLISHED_ARTIFACT_LIVE_NOT_RUN: configure B7_2_GITHUB_OPERATOR_PAT first.",
    );
    process.exit(2);
  }

  const explicit = process.env.OSVA_B7_2_GITHUB_CONNECTOR_STDIO_ENTRY?.trim();
  const stdioEntry =
    explicit && explicit.length > 0 ? explicit : loadManifestEntry();
  if (stdioEntry === undefined || !fs.existsSync(stdioEntry)) {
    console.error(
      "PUBLISHED_ARTIFACT_LIVE_NOT_RUN: missing connector entry. Run pnpm acceptance:b7-2:prepare.",
    );
    process.exit(2);
  }

  const installRoot = resolveConsumerInstallRootFromStdioEntry(stdioEntry);
  try {
    const provenance = readInstalledProvenance(installRoot);
    assertProvenance(provenance);
    console.log(
      `Verified ${GITHUB_CONNECTOR_PACKAGE}@${GITHUB_CONNECTOR_VERSION} at ${stdioEntry}`,
    );
  } catch (error) {
    console.warn(`Provenance check partial: ${String(error)}`);
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
      "test/integration/b7-2-published-artifact-operational.integration.test.ts",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        OSVA_B7_2_PUBLISHED_ARTIFACT_LANE: "1",
        OSVA_B7_2_GITHUB_CONNECTOR_STDIO_ENTRY: stdioEntry,
      },
    },
  );
  process.exit(result.status ?? 1);
}

main();
