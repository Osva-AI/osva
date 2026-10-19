import path from "node:path";

import { TOOL_ERROR_CODES } from "@osva-ai/contracts";
import type {
  AgentId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { expect } from "vitest";

import type { McpConnectorCompatibilityCase } from "../fixtures/mcp-connector-compatibility.types.js";
import {
  FAKE_GITHUB_PAT,
  MOCK_REPOSITORY_JSON,
  startMockGithubHttpServer,
} from "../fixtures/mock-github-http-server.js";

const GITHUB_STDIO_FIXTURE_RELATIVE = path.join(
  "packages",
  "github",
  "test",
  "fixtures",
  ".build",
  "stdio-github-fixture.js",
);

export const githubConnectorCompatibilityCase: McpConnectorCompatibilityCase = {
  id: "github",
  connectorLabel: "GitHub connector",
  connectorKey: "github",
  connectorDisplayName: "GitHub",
  executionMode: "required",
  stdioEntryResolution: {
    explicitPathEnvVars: [
      "OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY",
      "OSVA_CONNECTOR_TEST_STDIO_ENTRY",
    ],
    connectorsRootEnvVar: "OSVA_CONNECTORS_ROOT",
    stdioFixtureRelativePathFromRoot: GITHUB_STDIO_FIXTURE_RELATIVE,
  },
  requireIntegrationEnvVars: ["OSVA_REQUIRE_GITHUB_CONNECTOR_INTEGRATION"],
  buildInstructions: [
    "From osva-connectors:",
    "  pnpm --filter @osva-ai/connector-github build",
    "  pnpm --filter @osva-ai/connector-github build:test-stdio-fixture",
  ],
  toolImport: {
    remoteToolName: "github.repository.get",
    toolKey: "githubRepositoryGet",
    toolName: "GitHub repository get",
    bindingName: "githubRepositoryGet",
  },
  secrets: {
    secretRefKey: "GITHUB_CONNECTOR_TEST_PAT",
    validSecretValue: FAKE_GITHUB_PAT,
    invalidSecretValue: "ghp_wrong_token_for_integration_test",
    secretEnvironment: {
      OSVA_CONNECTOR_GITHUB_TOKEN: { key: "GITHUB_CONNECTOR_TEST_PAT" },
    },
  },
  workspaceIds: {
    primary: "ws-github-int-a" as WorkspaceId,
    secondary: "ws-github-int-b" as WorkspaceId,
  },
  agentId: "agent-github-int" as AgentId,
  runId: "run-github-int" as RunId,
  runAttemptId: "run-attempt-github-int" as RunAttemptId,
  fixtureEnvironment(context) {
    return {
      OSVA_CONNECTOR_GITHUB_TEST_API_BASE_URL: context.apiBaseUrl,
    };
  },
  async startFixture() {
    const mockGithub = await startMockGithubHttpServer();
    return {
      apiBaseUrl: mockGithub.apiBaseUrl,
      leakedCredentialMarker: "DO_NOT_LEAK",
      leakedDebugMarker: "DO_NOT_LEAK_IN_TOOL_OUTPUT",
      setProviderMode(mode) {
        mockGithub.setMode(mode);
      },
      getProviderRequestCount() {
        return mockGithub.getRepositoryRequestCount();
      },
      getLastAuthorization() {
        return mockGithub.getLastAuthorization();
      },
      close() {
        return mockGithub.close();
      },
    };
  },
  happyPathInput: { owner: "Osva-AI", repo: "osva" },
  assertHappyPathOutput(output) {
    expect(output).toMatchObject({
      name: MOCK_REPOSITORY_JSON.name,
      fullName: MOCK_REPOSITORY_JSON.full_name,
      htmlUrl: MOCK_REPOSITORY_JSON.html_url,
    });
  },
  assertHappyPathSideEffects(context) {
    expect(context.getLastAuthorization?.()?.toLowerCase()).toContain(
      FAKE_GITHUB_PAT.toLowerCase(),
    );
  },
  assertInvalidCredentialsError(rejection) {
    expect(rejection).toMatchObject({
      code: TOOL_ERROR_CODES.MCP_TOOL_ERROR,
    });
  },
  cancellationSlowDelayMs: 30_000,
};
