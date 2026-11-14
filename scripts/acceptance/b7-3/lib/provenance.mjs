import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  CONNECTOR_SDK_VERSION,
  CONNECTOR_STDIO_ENTRY_RELATIVE,
  GA4_CONNECTOR_PACKAGE,
  GA4_CONNECTOR_VERSION,
  NODE_ENGINES_MIN,
  SHOPIFY_CONNECTOR_PACKAGE,
  SHOPIFY_CONNECTOR_VERSION,
} from "../constants.mjs";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * @param {string} packageName
 * @param {string} version
 * @returns {string | undefined}
 */
export function registryPublishedVersion(packageName, version) {
  const view = spawnSync(
    npmCmd,
    ["view", `${packageName}@${version}`, "version", "--json"],
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
 * @param {string} packageName
 */
export function resolvePublishedStdioEntry(installRoot, packageName) {
  const entry = path.join(
    installRoot,
    "node_modules",
    packageName,
    CONNECTOR_STDIO_ENTRY_RELATIVE,
  );
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Published connector entry missing at ${entry}. Run pnpm acceptance:b7-3:prepare first.`,
    );
  }
  return path.resolve(entry);
}

/**
 * @param {string} installRoot
 */
export function readInstalledProvenance(installRoot) {
  function readPkg(name) {
    const pkgPath = path.join(
      installRoot,
      "node_modules",
      name,
      "package.json",
    );
    if (!fs.existsSync(pkgPath)) {
      throw new Error(`Missing ${pkgPath}`);
    }
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  }

  const shopifyPkg = readPkg(SHOPIFY_CONNECTOR_PACKAGE);
  const ga4Pkg = readPkg(GA4_CONNECTOR_PACKAGE);
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

  const shopifyRegistry = registryPublishedVersion(
    SHOPIFY_CONNECTOR_PACKAGE,
    SHOPIFY_CONNECTOR_VERSION,
  );
  const ga4Registry = registryPublishedVersion(
    GA4_CONNECTOR_PACKAGE,
    GA4_CONNECTOR_VERSION,
  );

  return {
    shopifyPackage: SHOPIFY_CONNECTOR_PACKAGE,
    shopifyVersion: shopifyPkg.version,
    expectedShopifyVersion: SHOPIFY_CONNECTOR_VERSION,
    shopifyRegistryVersion: shopifyRegistry,
    shopifyRegistryMatchesPin: shopifyRegistry === SHOPIFY_CONNECTOR_VERSION,
    ga4Package: GA4_CONNECTOR_PACKAGE,
    ga4Version: ga4Pkg.version,
    expectedGa4Version: GA4_CONNECTOR_VERSION,
    ga4RegistryVersion: ga4Registry,
    ga4RegistryMatchesPin: ga4Registry === GA4_CONNECTOR_VERSION,
    connectorSdkVersion: sdkPkg?.version,
    expectedConnectorSdkVersion: CONNECTOR_SDK_VERSION,
    stdioEntryRelative: CONNECTOR_STDIO_ENTRY_RELATIVE,
    enginesNode: shopifyPkg.engines?.node ?? "",
    enginesSatisfiesNode24:
      typeof shopifyPkg.engines?.node === "string" &&
      (shopifyPkg.engines.node.includes(String(NODE_ENGINES_MIN)) ||
        shopifyPkg.engines.node.includes(">=24")),
  };
}

/**
 * @param {ReturnType<typeof readInstalledProvenance>} provenance
 */
export function assertProvenance(provenance) {
  if (provenance.shopifyVersion !== SHOPIFY_CONNECTOR_VERSION) {
    throw new Error(
      `Expected ${SHOPIFY_CONNECTOR_PACKAGE}@${SHOPIFY_CONNECTOR_VERSION}, got ${provenance.shopifyVersion}`,
    );
  }
  if (provenance.ga4Version !== GA4_CONNECTOR_VERSION) {
    throw new Error(
      `Expected ${GA4_CONNECTOR_PACKAGE}@${GA4_CONNECTOR_VERSION}, got ${provenance.ga4Version}`,
    );
  }
  if (provenance.shopifyRegistryVersion !== undefined) {
    if (!provenance.shopifyRegistryMatchesPin) {
      throw new Error(
        `Registry version ${provenance.shopifyRegistryVersion} does not match pin ${SHOPIFY_CONNECTOR_VERSION}`,
      );
    }
  }
  if (provenance.ga4RegistryVersion !== undefined) {
    if (!provenance.ga4RegistryMatchesPin) {
      throw new Error(
        `Registry version ${provenance.ga4RegistryVersion} does not match pin ${GA4_CONNECTOR_VERSION}`,
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

export function assertOperatorLiveLaneConfigured() {
  const shopifyToken =
    process.env.B7_3_SHOPIFY_OPERATOR_ACCESS_TOKEN?.trim() ?? "";
  const shopifyShop = process.env.B7_3_SHOPIFY_OPERATOR_SHOP?.trim() ?? "";
  const ga4Credentials =
    process.env.B7_3_GA4_OPERATOR_CREDENTIALS_PATH?.trim() ?? "";
  const ga4Property = process.env.B7_3_GA4_OPERATOR_PROPERTY_ID?.trim() ?? "";
  if (
    shopifyToken.length === 0 ||
    shopifyShop.length === 0 ||
    ga4Credentials.length === 0 ||
    ga4Property.length === 0
  ) {
    throw new Error(
      "B7.3 live lane requires B7_3_SHOPIFY_OPERATOR_ACCESS_TOKEN, B7_3_SHOPIFY_OPERATOR_SHOP, B7_3_GA4_OPERATOR_CREDENTIALS_PATH, and B7_3_GA4_OPERATOR_PROPERTY_ID.",
    );
  }
  if (!fs.existsSync(ga4Credentials)) {
    throw new Error(
      "B7_3_GA4_OPERATOR_CREDENTIALS_PATH must resolve to an existing service account JSON file on the operator machine.",
    );
  }
  return true;
}
