import fs from "node:fs";
import path from "node:path";

/**
 * Resolves the built osva-connectors test stdio entry script.
 *
 * Priority:
 * 1. OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY — absolute path to stdio-github-fixture.js
 * 2. OSVA_CONNECTORS_ROOT — repo root; uses packages/github/test/fixtures/.build/stdio-github-fixture.js
 */
export function resolveGithubConnectorTestStdioEntry(): string | undefined {
  const explicit = process.env.OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY?.trim();
  if (
    explicit !== undefined &&
    explicit.length > 0 &&
    fs.existsSync(explicit)
  ) {
    return path.resolve(explicit);
  }

  const root = process.env.OSVA_CONNECTORS_ROOT?.trim();
  if (root !== undefined && root.length > 0) {
    const built = path.join(
      root,
      "packages",
      "github",
      "test",
      "fixtures",
      ".build",
      "stdio-github-fixture.js",
    );
    if (fs.existsSync(built)) {
      return path.resolve(built);
    }
  }

  return undefined;
}

export function isGithubConnectorIntegrationRequired(): boolean {
  return process.env.OSVA_REQUIRE_GITHUB_CONNECTOR_INTEGRATION === "true";
}

export function missingGithubConnectorFixtureMessage(): string {
  return [
    "GitHub connector ToolGateway integration requires a built test stdio fixture.",
    "From osva-connectors:",
    "  pnpm --filter @osva-ai/connector-github build",
    "  pnpm --filter @osva-ai/connector-github build:test-stdio-fixture",
    "Then set OSVA_CONNECTORS_ROOT to the osva-connectors checkout, or",
    "OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY to the absolute path of",
    "packages/github/test/fixtures/.build/stdio-github-fixture.js",
  ].join("\n");
}
