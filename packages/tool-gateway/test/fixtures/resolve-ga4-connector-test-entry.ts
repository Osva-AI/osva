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

const GA4_STDIO_FIXTURE_RELATIVE = path.join(
  "packages",
  "tool-gateway",
  "test",
  "fixtures",
  ".build",
  "stdio-ga4-fixture.js",
);

export function resolveGa4ConnectorTestStdioEntry(): string | undefined {
  const fromEnv = resolveExternalConnectorStdioEntry({
    explicitPathEnvVars: [
      "OSVA_GA4_CONNECTOR_TEST_STDIO_ENTRY",
      "OSVA_B7_3_GA4_FIXTURE_STDIO_ENTRY",
      "OSVA_CONNECTOR_TEST_STDIO_ENTRY",
    ],
    connectorsRootEnvVar: "OSVA_OSVA_REPO_ROOT",
    stdioFixtureRelativePathFromRoot: GA4_STDIO_FIXTURE_RELATIVE,
  });
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  const built = path.join(OSVA_REPO_ROOT, GA4_STDIO_FIXTURE_RELATIVE);
  if (fs.existsSync(built)) {
    return built;
  }
  return undefined;
}

export function missingGa4ConnectorFixtureMessage(): string {
  return missingExternalConnectorFixtureMessage({
    connectorLabel: "GA4 connector (B7.3)",
    buildInstructions: [
      "From osva-connectors:",
      "  pnpm --filter @osva-ai/connector-ga4 build",
      "From osva:",
      "  pnpm --filter @osva/tool-gateway build:test-stdio-fixtures",
    ],
    explicitPathEnvVars: [
      "OSVA_GA4_CONNECTOR_TEST_STDIO_ENTRY",
      "OSVA_B7_3_GA4_FIXTURE_STDIO_ENTRY",
    ],
    connectorsRootEnvVar: "OSVA_CONNECTORS_ROOT",
    stdioFixtureRelativePathFromRoot: GA4_STDIO_FIXTURE_RELATIVE,
  });
}

export function isGa4ConnectorIntegrationRequired(): boolean {
  return isExternalConnectorIntegrationRequired([
    "OSVA_REQUIRE_GA4_CONNECTOR_INTEGRATION",
    "OSVA_REQUIRE_CONNECTOR_INTEGRATION",
  ]);
}
