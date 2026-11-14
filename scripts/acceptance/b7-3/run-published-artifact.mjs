#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GA4_CONNECTOR_PACKAGE,
  GA4_CONNECTOR_VERSION,
  SHOPIFY_CONNECTOR_PACKAGE,
  SHOPIFY_CONNECTOR_VERSION,
} from "./constants.mjs";
import {
  assertOperatorLiveLaneConfigured,
  assertProvenance,
  readInstalledProvenance,
  resolveConsumerInstallRootFromStdioEntry,
  resolvePublishedStdioEntry,
} from "./lib/provenance.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "artifacts/acceptance/b7-3/consumer-manifest.json",
);

function printHelp() {
  console.log(`Usage: pnpm acceptance:b7-3:published

Operator-only published dual-connector acceptance (read-only tools only).

Prerequisites:
  1. Docker (PostgreSQL + Valkey test containers)
  2. pnpm acceptance:b7-3:prepare
  3. Sandbox Shopify Admin API token + shop domain
  4. GA4 service account JSON path + property ID (read-only Viewer)

Env vars (operator machine, untracked):
  B7_3_SHOPIFY_OPERATOR_ACCESS_TOKEN
  B7_3_SHOPIFY_OPERATOR_SHOP
  B7_3_GA4_OPERATOR_CREDENTIALS_PATH
  B7_3_GA4_OPERATOR_PROPERTY_ID

Imports only shopify.shop.get and ga4.property.get.
`);
}

function loadManifestEntries() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return undefined;
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (
    typeof manifest.shopifyStdioEntry === "string" &&
    typeof manifest.ga4StdioEntry === "string"
  ) {
    return {
      shopify: manifest.shopifyStdioEntry,
      ga4: manifest.ga4StdioEntry,
    };
  }
  if (typeof manifest.installRoot === "string") {
    return {
      shopify: resolvePublishedStdioEntry(
        manifest.installRoot,
        SHOPIFY_CONNECTOR_PACKAGE,
      ),
      ga4: resolvePublishedStdioEntry(
        manifest.installRoot,
        GA4_CONNECTOR_PACKAGE,
      ),
    };
  }
  return undefined;
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  try {
    assertOperatorLiveLaneConfigured();
  } catch (error) {
    console.error(String(error));
    console.error(
      "PUBLISHED_ARTIFACT_LIVE_NOT_RUN: configure B7.3 operator env vars first.",
    );
    process.exit(2);
  }

  const manifest = loadManifestEntries();
  const shopifyStdioExplicit =
    process.env.OSVA_B7_3_SHOPIFY_CONNECTOR_STDIO_ENTRY?.trim() ?? "";
  const ga4StdioExplicit =
    process.env.OSVA_B7_3_GA4_CONNECTOR_STDIO_ENTRY?.trim() ?? "";
  const shopifyStdio =
    shopifyStdioExplicit.length > 0 ? shopifyStdioExplicit : manifest?.shopify;
  const ga4Stdio =
    ga4StdioExplicit.length > 0 ? ga4StdioExplicit : manifest?.ga4;

  if (
    shopifyStdio === undefined ||
    ga4Stdio === undefined ||
    !fs.existsSync(shopifyStdio) ||
    !fs.existsSync(ga4Stdio)
  ) {
    console.error(
      "PUBLISHED_ARTIFACT_LIVE_NOT_RUN: missing connector entries. Run pnpm acceptance:b7-3:prepare.",
    );
    process.exit(2);
  }

  const installRoot = resolveConsumerInstallRootFromStdioEntry(shopifyStdio);
  try {
    const provenance = readInstalledProvenance(installRoot);
    assertProvenance(provenance);
    console.log(
      `Verified ${SHOPIFY_CONNECTOR_PACKAGE}@${SHOPIFY_CONNECTOR_VERSION} and ${GA4_CONNECTOR_PACKAGE}@${GA4_CONNECTOR_VERSION}`,
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
      "test/integration/b7-3-published-artifact-operational.integration.test.ts",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        OSVA_B7_3_PUBLISHED_ARTIFACT_LANE: "1",
        OSVA_B7_3_SHOPIFY_CONNECTOR_STDIO_ENTRY: shopifyStdio,
        OSVA_B7_3_GA4_CONNECTOR_STDIO_ENTRY: ga4Stdio,
      },
    },
  );
  process.exit(result.status ?? 1);
}

main();
