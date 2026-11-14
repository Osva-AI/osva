import fs from "node:fs";
import path from "node:path";

import {
  CONNECTOR_SDK_VERSION,
  NPM_CONNECTOR_PACKAGE,
  NPM_CONNECTOR_STDIO_ENTRY_RELATIVE,
  NPM_CONNECTOR_VERSION,
  NODE_ENGINES_MIN,
} from "../constants.mjs";

/**
 * @param {string} installRoot
 */
export function resolvePublishedNpmStdioEntry(installRoot) {
  const entry = path.join(
    installRoot,
    "node_modules",
    NPM_CONNECTOR_PACKAGE,
    NPM_CONNECTOR_STDIO_ENTRY_RELATIVE,
  );
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Published connector entry missing at ${entry}. Run pnpm acceptance:b7-1:prepare first.`,
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
    NPM_CONNECTOR_PACKAGE,
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
  return {
    connectorPackage: NPM_CONNECTOR_PACKAGE,
    connectorVersion: pkg.version,
    expectedConnectorVersion: NPM_CONNECTOR_VERSION,
    connectorSdkVersion: sdkPkg?.version,
    expectedConnectorSdkVersion: CONNECTOR_SDK_VERSION,
    stdioEntryRelative: NPM_CONNECTOR_STDIO_ENTRY_RELATIVE,
    enginesNode: engines,
    enginesSatisfiesNode24: engineOk,
    integrity: pkg.osva?.integrity ?? pkg._integrity ?? null,
  };
}

/**
 * @param {ReturnType<typeof readInstalledProvenance>} provenance
 */
export function assertProvenance(provenance) {
  if (provenance.connectorVersion !== NPM_CONNECTOR_VERSION) {
    throw new Error(
      `Expected ${NPM_CONNECTOR_PACKAGE}@${NPM_CONNECTOR_VERSION}, got ${provenance.connectorVersion}`,
    );
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
