import fs from "node:fs";
import path from "node:path";

export interface ResolveExternalConnectorStdioEntryOptions {
  /**
   * Environment variables checked in order for an absolute path to a built stdio entry script.
   * The first non-empty value whose path exists on disk wins.
   */
  readonly explicitPathEnvVars: readonly string[];
  /**
   * When set with {@link stdioFixtureRelativePathFromRoot}, resolves
   * `path.join(connectorsRoot, relativeFixturePath)`.
   */
  readonly connectorsRootEnvVar?: string;
  readonly stdioFixtureRelativePathFromRoot?: string;
}

/**
 * Resolves a built external connector stdio entry for ToolGateway integration tests.
 *
 * Connector repositories should publish a test stdio fixture and document the relative path
 * from the repo root. OSVA integration jobs set either an explicit entry path or
 * `OSVA_CONNECTORS_ROOT` plus the documented relative path.
 */
export function resolveExternalConnectorStdioEntry(
  options: ResolveExternalConnectorStdioEntryOptions,
): string | undefined {
  for (const envVar of options.explicitPathEnvVars) {
    const explicit = process.env[envVar]?.trim();
    if (
      explicit !== undefined &&
      explicit.length > 0 &&
      fs.existsSync(explicit)
    ) {
      return path.resolve(explicit);
    }
  }

  const rootEnv = options.connectorsRootEnvVar;
  const relativePath = options.stdioFixtureRelativePathFromRoot;
  if (rootEnv === undefined || relativePath === undefined) {
    return undefined;
  }

  const root = process.env[rootEnv]?.trim();
  if (root === undefined || root.length === 0) {
    return undefined;
  }

  const built = path.join(root, relativePath);
  if (fs.existsSync(built)) {
    return path.resolve(built);
  }

  return undefined;
}

export function isExternalConnectorIntegrationRequired(
  requireEnvVars: readonly string[],
): boolean {
  return requireEnvVars.some((name) => process.env[name] === "true");
}

export interface MissingExternalConnectorFixtureMessageOptions {
  readonly connectorLabel: string;
  readonly buildInstructions: readonly string[];
  readonly explicitPathEnvVars: readonly string[];
  readonly connectorsRootEnvVar?: string;
  readonly stdioFixtureRelativePathFromRoot?: string;
}

export function missingExternalConnectorFixtureMessage(
  options: MissingExternalConnectorFixtureMessageOptions,
): string {
  const explicitHints = options.explicitPathEnvVars
    .map((name) => `  ${name}=<absolute path to stdio entry>`)
    .join("\n");
  const rootHint =
    options.connectorsRootEnvVar !== undefined &&
    options.stdioFixtureRelativePathFromRoot !== undefined
      ? `\nOr set ${options.connectorsRootEnvVar} to the connector repository checkout (fixture at ${options.stdioFixtureRelativePathFromRoot}).`
      : "";

  return [
    `${options.connectorLabel} ToolGateway integration requires a built test stdio fixture.`,
    ...options.buildInstructions,
    "Then configure:",
    explicitHints,
    rootHint,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
