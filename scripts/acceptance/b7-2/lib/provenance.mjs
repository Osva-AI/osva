import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  CONNECTOR_SDK_VERSION,
  GITHUB_CONNECTOR_PACKAGE,
  GITHUB_CONNECTOR_STDIO_ENTRY_RELATIVE,
  GITHUB_CONNECTOR_VERSION,
  NODE_ENGINES_MIN,
} from "../constants.mjs";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * @returns {string | undefined}
 */
export function registryPublishedVersion() {
  const view = spawnSync(
    npmCmd,
    [
      "view",
      `${GITHUB_CONNECTOR_PACKAGE}@${GITHUB_CONNECTOR_VERSION}`,
      "version",
      "--json",
    ],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (view.status !== 0) {
    return undefined;
  }
  const trimmed = view.stdout.trim().replace(/^"|"$/g, "");
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * @param {string} installRoot
 */
export function resolvePublishedGithubStdioEntry(installRoot) {
  const entry = path.join(
    installRoot,
    "node_modules",
    GITHUB_CONNECTOR_PACKAGE,
    GITHUB_CONNECTOR_STDIO_ENTRY_RELATIVE,
  );
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Published connector entry missing at ${entry}. Run pnpm acceptance:b7-2:prepare first.`,
    );
  }
  return path.resolve(entry);
}

/**
 * @param {string} installRoot
 */
export function readInstalledProvenance(installRoot) {
  const pkgPath = path.join(
    installRoot,
    "node_modules",
    GITHUB_CONNECTOR_PACKAGE,
    "package.json",
  );
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing ${pkgPath}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const sdkPath = path.join(
    installRoot,
    "node_modules",
    "@osva-ai",
    "connector-sdk",
    "package.json",
  );
  const sdkPkg = fs.existsSync(sdkPath)
    ? JSON.parse(fs.readFileSync(sdkPath, "utf8"))
    : undefined;
  const engines = pkg.engines?.node ?? "";
  const engineOk =
    typeof engines === "string" &&
    (engines.includes(String(NODE_ENGINES_MIN)) || engines.includes(">=24"));
  const registryVersion = registryPublishedVersion();
  return {
    connectorPackage: GITHUB_CONNECTOR_PACKAGE,
    connectorVersion: pkg.version,
    expectedConnectorVersion: GITHUB_CONNECTOR_VERSION,
    registryVerifiedVersion: registryVersion,
    registryVersionMatchesPin: registryVersion === GITHUB_CONNECTOR_VERSION,
    connectorSdkVersion: sdkPkg?.version,
    expectedConnectorSdkVersion: CONNECTOR_SDK_VERSION,
    stdioEntryRelative: GITHUB_CONNECTOR_STDIO_ENTRY_RELATIVE,
    enginesNode: engines,
    enginesSatisfiesNode24: engineOk,
  };
}

/**
 * @param {ReturnType<typeof readInstalledProvenance>} provenance
 */
export function assertProvenance(provenance) {
  if (provenance.connectorVersion !== GITHUB_CONNECTOR_VERSION) {
    throw new Error(
      `Expected ${GITHUB_CONNECTOR_PACKAGE}@${GITHUB_CONNECTOR_VERSION}, got ${provenance.connectorVersion}`,
    );
  }
  if (provenance.registryVerifiedVersion !== undefined) {
    if (!provenance.registryVersionMatchesPin) {
      throw new Error(
        `Registry version ${provenance.registryVerifiedVersion} does not match pin ${GITHUB_CONNECTOR_VERSION}`,
      );
    }
  }
  if (
    provenance.connectorSdkVersion !== undefined &&
    provenance.connectorSdkVersion !== CONNECTOR_SDK_VERSION
  ) {
    throw new Error(
      `Expected @osva-ai/connector-sdk@${CONNECTOR_SDK_VERSION}, got ${provenance.connectorSdkVersion}`,
    );
  }
}

export function resolveConsumerInstallRootFromStdioEntry(stdioEntry) {
  const connectorPkgDir = path.resolve(stdioEntry, "..", "..");
  return path.resolve(connectorPkgDir, "..", "..", "..");
}

/**
 * Verifies operator PAT is present without printing the value.
 */
export function assertOperatorPatConfigured() {
  const value = process.env.B7_2_GITHUB_OPERATOR_PAT?.trim() ?? "";
  if (value.length === 0) {
    throw new Error(
      "B7_2_GITHUB_OPERATOR_PAT must be set for the published live lane (read-only fine-grained token).",
    );
  }
  return true;
}
