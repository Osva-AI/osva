import type {
  AgentId,
  ConnectorVersionId,
  RunAttemptId,
  RunId,
  ToolAuthorizationContext,
  ToolPolicy,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { TOOL_ERROR_CODES } from "@osva-ai/contracts";
import { createMcpClientPool } from "@osva/adapters-mcp-client";
import {
  MemoryConnectorRepository,
  MemorySecretResolver,
  MemoryToolRepository,
  MemoryWorkspaceRepository,
  SecretNotFoundError,
} from "@osva/adapters-memory";
import {
  ConnectorVersionNotFoundError,
  StdioConnectorsDisabledError,
  Workspace,
  createConnectorApplication,
} from "@osva/domain";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DefaultToolPolicy,
  ToolGateway,
  ToolGatewayError,
} from "../src/index.js";
import {
  FAKE_GITHUB_PAT,
  MOCK_REPOSITORY_JSON,
  startMockGithubHttpServer,
  type MockGithubHttpServer,
} from "./fixtures/mock-github-http-server.js";
import {
  isGithubConnectorIntegrationRequired,
  missingGithubConnectorFixtureMessage,
  resolveGithubConnectorTestStdioEntry,
} from "./fixtures/resolve-github-connector-test-entry.js";
import { fakeControlPlaneScope } from "./test-scope.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const WORKSPACE_A = "ws-github-int-a" as WorkspaceId;
const WORKSPACE_B = "ws-github-int-b" as WorkspaceId;
const AGENT_ID = "agent-github-int" as AgentId;
const RUN_ID = "run-github-int" as RunId;
const RUN_ATTEMPT_ID = "run-attempt-github-int" as RunAttemptId;
const SECRET_REF_KEY = "GITHUB_CONNECTOR_TEST_PAT";
const REMOTE_TOOL_NAME = "github.repository.get";
const INTEGRATION_TIMEOUT_MS = 60_000;

class DenyingToolPolicy implements ToolPolicy {
  authorizeToolInvocation(context: ToolAuthorizationContext): void {
    void context;
    throw new ToolGatewayError(
      TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
      "Tool invocation was denied by policy.",
    );
  }
}

const stdioEntry = resolveGithubConnectorTestStdioEntry();
const integrationRequired = isGithubConnectorIntegrationRequired();
const describeIntegration =
  stdioEntry === undefined && !integrationRequired ? describe.skip : describe;

describeIntegration("GitHub connector ToolGateway integration", () => {
  let mockGithub: MockGithubHttpServer | undefined;
  let mcpClientPool: ReturnType<typeof createMcpClientPool> | undefined;

  beforeAll(() => {
    if (stdioEntry === undefined) {
      if (integrationRequired) {
        throw new Error(missingGithubConnectorFixtureMessage());
      }
      console.warn(missingGithubConnectorFixtureMessage());
    }
  });

  afterEach(async () => {
    if (mcpClientPool !== undefined) {
      await mcpClientPool.close();
      mcpClientPool = undefined;
    }
    if (mockGithub !== undefined) {
      await mockGithub.close();
      mockGithub = undefined;
    }
  });

  function createIds() {
    let counter = 0;
    return {
      createId() {
        counter += 1;
        return `github-int-id-${String(counter)}`;
      },
    };
  }

  async function seedWorkspaces(
    workspaces: MemoryWorkspaceRepository,
    ids: readonly WorkspaceId[],
  ) {
    for (const id of ids) {
      await workspaces.save(
        Workspace.create({
          id,
          name: `Workspace ${id}`,
          createdAt: NOW,
        }),
      );
    }
  }

  function createApplication(options: {
    readonly stdioConnectorsEnabled: boolean;
    readonly secrets: Readonly<Record<string, string>>;
  }) {
    const workspaces = new MemoryWorkspaceRepository();
    const connectors = new MemoryConnectorRepository();
    const tools = new MemoryToolRepository();
    const secretResolver = new MemorySecretResolver(options.secrets);
    mcpClientPool = createMcpClientPool({
      secretResolver,
      stdioConnectorsEnabled: options.stdioConnectorsEnabled,
      allowPrivateNetworks: false,
    });

    const application = createConnectorApplication({
      workspaces,
      connectors,
      tools,
      mcpClientPool,
      mcpRuntimePolicy: {
        stdioConnectorsEnabled: options.stdioConnectorsEnabled,
      },
      clock: { now: () => NOW },
      ids: createIds(),
    });

    return { application, workspaces, connectors, tools, secretResolver };
  }

  function stdioTransportConfig(apiBaseUrl: string) {
    if (stdioEntry === undefined) {
      throw new Error("stdio entry is not configured.");
    }
    return {
      command: process.execPath,
      args: [stdioEntry],
      environment: {
        OSVA_CONNECTOR_GITHUB_TEST_API_BASE_URL: apiBaseUrl,
      },
      secretEnvironment: {
        OSVA_CONNECTOR_GITHUB_TOKEN: { key: SECRET_REF_KEY },
      },
    } as const;
  }

  async function registerGithubConnector(
    application: ReturnType<typeof createConnectorApplication>,
    scope: ReturnType<typeof fakeControlPlaneScope>,
    apiBaseUrl: string,
  ) {
    const connector = await application.createConnector.execute(scope, {
      workspaceId: WORKSPACE_A,
      key: "github",
      name: "GitHub",
    });
    const connectorVersion = await application.appendConnectorVersion.execute(
      scope,
      {
        connectorId: connector.id,
        kind: "MCP",
        transport: "STDIO",
        transportConfig: stdioTransportConfig(apiBaseUrl),
      },
    );
    return { connector, connectorVersion };
  }

  async function importRepositoryGetTool(
    application: ReturnType<typeof createConnectorApplication>,
    scope: ReturnType<typeof fakeControlPlaneScope>,
    connectorVersionId: ConnectorVersionId,
  ) {
    await application.discoverConnectorTools.execute(scope, {
      connectorVersionId,
    });
    const imported = await application.importMcpTools.execute(scope, {
      connectorVersionId,
      tools: [
        {
          remoteToolName: REMOTE_TOOL_NAME,
          toolKey: "githubRepositoryGet",
          toolName: "GitHub repository get",
        },
      ],
    });
    return imported[0]!;
  }

  function authContext(
    toolVersionId: ToolVersionId,
    bindingName = "githubRepositoryGet",
  ): ToolAuthorizationContext {
    return {
      workspaceId: WORKSPACE_A,
      agentId: AGENT_ID,
      runId: RUN_ID,
      runAttemptId: RUN_ATTEMPT_ID,
      bindingName,
      toolVersionId,
    };
  }

  it(
    "discovers, imports, and invokes github.repository.get through ToolGateway",
    async () => {
      mockGithub = await startMockGithubHttpServer();
      const harness = createApplication({
        stdioConnectorsEnabled: true,
        secrets: { [SECRET_REF_KEY]: FAKE_GITHUB_PAT },
      });
      await seedWorkspaces(harness.workspaces, [WORKSPACE_A]);

      const scope = fakeControlPlaneScope(WORKSPACE_A);
      const { connectorVersion } = await registerGithubConnector(
        harness.application,
        scope,
        mockGithub.apiBaseUrl,
      );
      const imported = await importRepositoryGetTool(
        harness.application,
        scope,
        connectorVersion.id,
      );

      expect(imported.createdNewToolVersion).toBe(true);
      expect(imported.remoteToolName).toBe(REMOTE_TOOL_NAME);

      const storedVersion = await harness.tools.findToolVersionById(
        imported.toolVersionId,
      );
      expect(storedVersion?.type).toBe("MCP");
      expect(storedVersion?.mcp?.remoteToolName).toBe(REMOTE_TOOL_NAME);
      expect(storedVersion?.mcp?.connectorVersionId).toBe(connectorVersion.id);

      const persistedConnectorVersion =
        await harness.connectors.findConnectorVersionById(connectorVersion.id);
      expect(
        JSON.stringify(persistedConnectorVersion?.transportConfig),
      ).not.toContain(FAKE_GITHUB_PAT);

      expect(mockGithub.getRepositoryRequestCount()).toBe(0);

      const gateway = new ToolGateway({
        tools: harness.tools,
        connectors: harness.connectors,
        mcpClientPool: mcpClientPool!,
        policy: new DefaultToolPolicy(),
      });

      const output = await gateway.invoke({
        toolVersionId: imported.toolVersionId,
        input: { owner: "Osva-AI", repo: "osva" },
        authorization: authContext(imported.toolVersionId),
      });

      expect(output).toMatchObject({
        name: MOCK_REPOSITORY_JSON.name,
        fullName: MOCK_REPOSITORY_JSON.full_name,
        htmlUrl: MOCK_REPOSITORY_JSON.html_url,
      });

      expect(mockGithub.getRepositoryRequestCount()).toBe(1);
      expect(mockGithub.getLastAuthorization()?.toLowerCase()).toContain(
        FAKE_GITHUB_PAT.toLowerCase(),
      );

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(FAKE_GITHUB_PAT);
      expect(serialized).not.toContain("DO_NOT_LEAK");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "denies invocation when ToolPolicy rejects the request before MCP execution",
    async () => {
      mockGithub = await startMockGithubHttpServer();
      const harness = createApplication({
        stdioConnectorsEnabled: true,
        secrets: { [SECRET_REF_KEY]: FAKE_GITHUB_PAT },
      });
      await seedWorkspaces(harness.workspaces, [WORKSPACE_A]);
      const scope = fakeControlPlaneScope(WORKSPACE_A);
      const { connectorVersion } = await registerGithubConnector(
        harness.application,
        scope,
        mockGithub.apiBaseUrl,
      );
      const imported = await importRepositoryGetTool(
        harness.application,
        scope,
        connectorVersion.id,
      );

      const requestsBeforeDeny = mockGithub.getRepositoryRequestCount();

      const gateway = new ToolGateway({
        tools: harness.tools,
        connectors: harness.connectors,
        mcpClientPool: mcpClientPool!,
        policy: new DenyingToolPolicy(),
      });

      await expect(
        gateway.invoke({
          toolVersionId: imported.toolVersionId,
          input: { owner: "Osva-AI", repo: "osva" },
          authorization: authContext(imported.toolVersionId),
        }),
      ).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
      });

      expect(mockGithub.getRepositoryRequestCount()).toBe(requestsBeforeDeny);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "fails when SecretReference resolution is missing for stdio secretEnvironment",
    async () => {
      mockGithub = await startMockGithubHttpServer();
      const harness = createApplication({
        stdioConnectorsEnabled: true,
        secrets: {},
      });
      await seedWorkspaces(harness.workspaces, [WORKSPACE_A]);
      const scope = fakeControlPlaneScope(WORKSPACE_A);
      const { connectorVersion } = await registerGithubConnector(
        harness.application,
        scope,
        mockGithub.apiBaseUrl,
      );

      await expect(
        harness.application.discoverConnectorTools.execute(scope, {
          connectorVersionId: connectorVersion.id,
        }),
      ).rejects.toBeInstanceOf(SecretNotFoundError);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "rejects STDIO connector configuration when the operator gate is disabled",
    async () => {
      const harness = createApplication({
        stdioConnectorsEnabled: false,
        secrets: { [SECRET_REF_KEY]: FAKE_GITHUB_PAT },
      });
      await seedWorkspaces(harness.workspaces, [WORKSPACE_A]);
      const scope = fakeControlPlaneScope(WORKSPACE_A);
      const connector = await harness.application.createConnector.execute(
        scope,
        {
          workspaceId: WORKSPACE_A,
          key: "github",
          name: "GitHub",
        },
      );

      await expect(
        harness.application.appendConnectorVersion.execute(scope, {
          connectorId: connector.id,
          kind: "MCP",
          transport: "STDIO",
          transportConfig: stdioTransportConfig("http://127.0.0.1:9/api/v3"),
        }),
      ).rejects.toBeInstanceOf(StdioConnectorsDisabledError);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns a sanitized authorization failure for wrong GitHub credentials",
    async () => {
      mockGithub = await startMockGithubHttpServer();
      const harness = createApplication({
        stdioConnectorsEnabled: true,
        secrets: { [SECRET_REF_KEY]: "ghp_wrong_token_for_integration_test" },
      });
      await seedWorkspaces(harness.workspaces, [WORKSPACE_A]);
      const scope = fakeControlPlaneScope(WORKSPACE_A);
      const { connectorVersion } = await registerGithubConnector(
        harness.application,
        scope,
        mockGithub.apiBaseUrl,
      );
      const imported = await importRepositoryGetTool(
        harness.application,
        scope,
        connectorVersion.id,
      );

      const gateway = new ToolGateway({
        tools: harness.tools,
        connectors: harness.connectors,
        mcpClientPool: mcpClientPool!,
        policy: new DefaultToolPolicy(),
      });

      const rejection = await gateway
        .invoke({
          toolVersionId: imported.toolVersionId,
          input: { owner: "Osva-AI", repo: "osva" },
          authorization: authContext(imported.toolVersionId),
        })
        .catch((error: unknown) => error);

      expect(rejection).toMatchObject({
        code: TOOL_ERROR_CODES.MCP_TOOL_ERROR,
      });
      expect(String(rejection)).not.toContain(
        "ghp_wrong_token_for_integration_test",
      );
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "rejects cross-workspace connector discovery",
    async () => {
      mockGithub = await startMockGithubHttpServer();
      const harness = createApplication({
        stdioConnectorsEnabled: true,
        secrets: { [SECRET_REF_KEY]: FAKE_GITHUB_PAT },
      });
      await seedWorkspaces(harness.workspaces, [WORKSPACE_A, WORKSPACE_B]);
      const scopeA = fakeControlPlaneScope(WORKSPACE_A);
      const { connectorVersion } = await registerGithubConnector(
        harness.application,
        scopeA,
        mockGithub.apiBaseUrl,
      );

      const scopeB = fakeControlPlaneScope(WORKSPACE_B);
      await expect(
        harness.application.discoverConnectorTools.execute(scopeB, {
          connectorVersionId: connectorVersion.id,
        }),
      ).rejects.toBeInstanceOf(ConnectorVersionNotFoundError);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "sanitizes mock provider 500 errors at the ToolGateway boundary",
    async () => {
      mockGithub = await startMockGithubHttpServer();
      const harness = createApplication({
        stdioConnectorsEnabled: true,
        secrets: { [SECRET_REF_KEY]: FAKE_GITHUB_PAT },
      });
      await seedWorkspaces(harness.workspaces, [WORKSPACE_A]);
      const scope = fakeControlPlaneScope(WORKSPACE_A);
      const { connectorVersion } = await registerGithubConnector(
        harness.application,
        scope,
        mockGithub.apiBaseUrl,
      );
      const imported = await importRepositoryGetTool(
        harness.application,
        scope,
        connectorVersion.id,
      );
      mockGithub.setMode("server_error");

      const gateway = new ToolGateway({
        tools: harness.tools,
        connectors: harness.connectors,
        mcpClientPool: mcpClientPool!,
        policy: new DefaultToolPolicy(),
      });

      const rejection = await gateway
        .invoke({
          toolVersionId: imported.toolVersionId,
          input: { owner: "Osva-AI", repo: "osva" },
          authorization: authContext(imported.toolVersionId),
        })
        .catch((error) => error);

      expect(rejection).toMatchObject({
        code: TOOL_ERROR_CODES.MCP_TOOL_ERROR,
      });
      expect(String(rejection)).not.toContain("DO_NOT_LEAK_IN_TOOL_OUTPUT");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
