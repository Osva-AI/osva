import path from "node:path";

import {
  isExternalConnectorIntegrationRequired,
  missingExternalConnectorFixtureMessage,
  resolveExternalConnectorStdioEntry,
} from "./resolve-external-connector-stdio-entry.js";

const GITHUB_STDIO_FIXTURE_RELATIVE = path.join(
  "packages",
  "github",
  "test",
  "fixtures",
  ".build",
  "stdio-github-fixture.js",
);

/**
 * Resolves the built osva-connectors test stdio entry script.
 *
 * Priority:
 * 1. OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY — absolute path to stdio-github-fixture.js
 * 2. OSVA_CONNECTOR_TEST_STDIO_ENTRY — generic explicit path (any connector fixture)
 * 3. OSVA_CONNECTORS_ROOT — repo root; uses packages/github/test/fixtures/.build/stdio-github-fixture.js
 */
export function resolveGithubConnectorTestStdioEntry(): string | undefined {
  return resolveExternalConnectorStdioEntry({
    explicitPathEnvVars: [
      "OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY",
      "OSVA_CONNECTOR_TEST_STDIO_ENTRY",
    ],
    connectorsRootEnvVar: "OSVA_CONNECTORS_ROOT",
    stdioFixtureRelativePathFromRoot: GITHUB_STDIO_FIXTURE_RELATIVE,
  });
}

export function isGithubConnectorIntegrationRequired(): boolean {
  return isExternalConnectorIntegrationRequired([
    "OSVA_REQUIRE_GITHUB_CONNECTOR_INTEGRATION",
    "OSVA_REQUIRE_CONNECTOR_INTEGRATION",
  ]);
}

export function missingGithubConnectorFixtureMessage(): string {
  return missingExternalConnectorFixtureMessage({
    connectorLabel: "GitHub connector",
    buildInstructions: [
      "From osva-connectors:",
      "  pnpm --filter @osva-ai/connector-github build",
      "  pnpm --filter @osva-ai/connector-github build:test-stdio-fixture",
    ],
    explicitPathEnvVars: [
      "OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY",
      "OSVA_CONNECTOR_TEST_STDIO_ENTRY",
    ],
    connectorsRootEnvVar: "OSVA_CONNECTORS_ROOT",
    stdioFixtureRelativePathFromRoot: GITHUB_STDIO_FIXTURE_RELATIVE,
  });
}
