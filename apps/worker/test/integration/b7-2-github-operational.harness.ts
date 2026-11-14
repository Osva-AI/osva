import fs from "node:fs";
import path from "node:path";

import type { ConnectorVersionId, ToolVersionId } from "@osva-ai/contracts";

import {
  FAKE_GITHUB_PAT,
  MOCK_REPOSITORY_JSON,
} from "../../../../packages/tool-gateway/test/fixtures/mock-github-http-server.js";
import { resolveGithubConnectorTestStdioEntry } from "../../../../packages/tool-gateway/test/fixtures/resolve-github-connector-test-entry.js";

import {
  buildStdioTransportConfig,
  discoverMcpTools,
  importMcpTools,
  registerStdioConnectorVersion,
  type StdioMcpTransportConfig,
} from "./b7-1-stdio-runtime-harness.js";

/** SecretReference key resolved via ProcessEnvSecretResolver (fixture lane). */
export const GITHUB_FIXTURE_SECRET_REF_KEY = "GITHUB_CONNECTOR_TEST_PAT";

/** Operator-only live lane secret reference (never logged). */
export const GITHUB_LIVE_SECRET_REF_KEY = "B7_2_GITHUB_OPERATOR_PAT";

export const GITHUB_REPOSITORY_GET_REMOTE = "github.repository.get";
export const GITHUB_REPOSITORY_GET_BINDING = "githubRepositoryGet";

export const GITHUB_LEAK_MARKER = "DO_NOT_LEAK_IN_TOOL_OUTPUT";

export function isGithubFixtureStdioAvailable(): boolean {
  return resolveGithubFixtureStdioEntryOrUndefined() !== undefined;
}

function resolveGithubFixtureStdioEntryOrUndefined(): string | undefined {
  const explicit = process.env.OSVA_B7_2_FIXTURE_STDIO_ENTRY?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    const resolved = path.resolve(explicit);
    return fs.existsSync(resolved) ? resolved : undefined;
  }
  return resolveGithubConnectorTestStdioEntry();
}

export function resolveGithubFixtureStdioEntry(): string {
  const entry = resolveGithubFixtureStdioEntryOrUndefined();
  if (entry === undefined) {
    throw new Error(
      "GitHub test stdio fixture not found. Build osva-connectors stdio-github-fixture and set OSVA_CONNECTORS_ROOT or OSVA_B7_2_FIXTURE_STDIO_ENTRY.",
    );
  }
  return entry;
}

export function buildGithubFixtureTransportConfig(input: {
  readonly stdioEntry: string;
  readonly apiBaseUrl: string;
  readonly includeSecretReference?: boolean;
}): StdioMcpTransportConfig {
  const base = buildStdioTransportConfig(input.stdioEntry, {
    OSVA_CONNECTOR_GITHUB_TEST_API_BASE_URL: input.apiBaseUrl,
  });
  if (input.includeSecretReference === false) {
    return base;
  }
  return {
    ...base,
    secretEnvironment: {
      OSVA_CONNECTOR_GITHUB_TOKEN: { key: GITHUB_FIXTURE_SECRET_REF_KEY },
    },
  };
}

export function buildGithubLiveTransportConfig(
  stdioEntry: string,
): StdioMcpTransportConfig {
  return {
    ...buildStdioTransportConfig(stdioEntry),
    secretEnvironment: {
      OSVA_CONNECTOR_GITHUB_TOKEN: { key: GITHUB_LIVE_SECRET_REF_KEY },
    },
  };
}

export function fixturePatEnv(
  value: string | undefined,
): Record<string, string> {
  if (value === undefined || value.trim().length === 0) {
    return {};
  }
  return { [GITHUB_FIXTURE_SECRET_REF_KEY]: value };
}

export function livePatEnvPresent(): boolean {
  const value = process.env[GITHUB_LIVE_SECRET_REF_KEY]?.trim() ?? "";
  return value.length > 0;
}

export function isGithubPublishedArtifactLaneEnabled(): boolean {
  return (
    process.env.OSVA_B7_2_PUBLISHED_ARTIFACT_LANE === "1" &&
    typeof process.env.OSVA_B7_2_GITHUB_CONNECTOR_STDIO_ENTRY === "string" &&
    process.env.OSVA_B7_2_GITHUB_CONNECTOR_STDIO_ENTRY.trim().length > 0 &&
    livePatEnvPresent()
  );
}

export function readGithubPublishedStdioEntry(): string {
  const entry =
    process.env.OSVA_B7_2_GITHUB_CONNECTOR_STDIO_ENTRY?.trim() ?? "";
  if (entry.length === 0) {
    throw new Error(
      "OSVA_B7_2_GITHUB_CONNECTOR_STDIO_ENTRY is required for the published GitHub lane.",
    );
  }
  return entry;
}

export async function seedGithubRepositoryGetTool(input: {
  readonly origin: string;
  readonly transportConfig: StdioMcpTransportConfig;
  readonly connectorKey?: string;
}): Promise<{
  readonly connectorId: string;
  readonly connectorVersionId: ConnectorVersionId;
  readonly toolVersionId: ToolVersionId;
}> {
  const { connectorId, connectorVersionId } =
    await registerStdioConnectorVersion({
      origin: input.origin,
      connectorKey: input.connectorKey ?? "b7-2-github",
      connectorName: "B7.2 GitHub MCP",
      transportConfig: input.transportConfig,
    });
  const discovered = await discoverMcpTools(
    input.origin,
    connectorId,
    connectorVersionId,
  );
  if (
    !discovered.some(
      (tool) => tool.remoteToolName === GITHUB_REPOSITORY_GET_REMOTE,
    )
  ) {
    throw new Error(
      `Expected ${GITHUB_REPOSITORY_GET_REMOTE} in discovery: ${discovered.map((t) => t.remoteToolName).join(", ")}`,
    );
  }
  const imported = await importMcpTools({
    origin: input.origin,
    connectorVersionId,
    tools: [
      {
        remoteToolName: GITHUB_REPOSITORY_GET_REMOTE,
        toolKey: GITHUB_REPOSITORY_GET_BINDING,
        toolName: "GitHub repository get",
      },
    ],
  });
  return {
    connectorId,
    connectorVersionId,
    toolVersionId: imported[0]!.toolVersionId,
  };
}

export function assertFixtureRepositoryOutput(output: unknown): void {
  if (output === null || typeof output !== "object") {
    throw new Error(`Expected repository object, got ${String(output)}`);
  }
  const record = output as Record<string, unknown>;
  if (record.name !== MOCK_REPOSITORY_JSON.name) {
    throw new Error(`Unexpected repository name: ${String(record.name)}`);
  }
}

export function assertNoSecretLeakInJson(
  payload: string,
  secretValue: string,
): void {
  if (payload.includes(secretValue)) {
    throw new Error("Secret value leaked into JSON payload.");
  }
  if (payload.includes(GITHUB_LEAK_MARKER)) {
    throw new Error("Provider debug marker leaked into JSON payload.");
  }
}

export { FAKE_GITHUB_PAT, MOCK_REPOSITORY_JSON };
