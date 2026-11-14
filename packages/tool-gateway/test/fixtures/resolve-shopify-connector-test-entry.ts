import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isExternalConnectorIntegrationRequired,
  missingExternalConnectorFixtureMessage,
  resolveExternalConnectorStdioEntry,
} from "./resolve-external-connector-stdio-entry.js";

const OSVA_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const SHOPIFY_STDIO_FIXTURE_RELATIVE = path.join(
  "packages",
  "tool-gateway",
  "test",
  "fixtures",
  ".build",
  "stdio-shopify-fixture.js",
);

/**
 * Built B7.3 Shopify stdio fixture lives in the osva repo (not osva-connectors).
 */
export function resolveShopifyConnectorTestStdioEntry(): string | undefined {
  const fromEnv = resolveExternalConnectorStdioEntry({
    explicitPathEnvVars: [
      "OSVA_SHOPIFY_CONNECTOR_TEST_STDIO_ENTRY",
      "OSVA_B7_3_SHOPIFY_FIXTURE_STDIO_ENTRY",
      "OSVA_CONNECTOR_TEST_STDIO_ENTRY",
    ],
    connectorsRootEnvVar: "OSVA_OSVA_REPO_ROOT",
    stdioFixtureRelativePathFromRoot: SHOPIFY_STDIO_FIXTURE_RELATIVE,
  });
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  const built = path.join(OSVA_REPO_ROOT, SHOPIFY_STDIO_FIXTURE_RELATIVE);
  if (fs.existsSync(built)) {
    return built;
  }
  return undefined;
}

export function missingShopifyConnectorFixtureMessage(): string {
  return missingExternalConnectorFixtureMessage({
    connectorLabel: "Shopify connector (B7.3)",
    buildInstructions: [
      "From osva-connectors:",
      "  pnpm --filter @osva-ai/connector-shopify build",
      "From osva:",
      "  pnpm --filter @osva/tool-gateway build:test-stdio-fixtures",
    ],
    explicitPathEnvVars: [
      "OSVA_SHOPIFY_CONNECTOR_TEST_STDIO_ENTRY",
      "OSVA_B7_3_SHOPIFY_FIXTURE_STDIO_ENTRY",
    ],
    connectorsRootEnvVar: "OSVA_CONNECTORS_ROOT",
    stdioFixtureRelativePathFromRoot: SHOPIFY_STDIO_FIXTURE_RELATIVE,
  });
}

export function isShopifyConnectorIntegrationRequired(): boolean {
  return isExternalConnectorIntegrationRequired([
    "OSVA_REQUIRE_SHOPIFY_CONNECTOR_INTEGRATION",
    "OSVA_REQUIRE_CONNECTOR_INTEGRATION",
  ]);
}
