import type {
  ToolAuthorizationContext,
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
} from "../../src/index.js";
import { invokeMcpToolVersion } from "../../src/internal/mcp-tool-executor.js";
import { fakeControlPlaneScope } from "../test-scope.js";
import type {
  McpConnectorCompatibilityCase,
  McpConnectorCompatibilityFixtureContext,
  RegisteredConnectorImport,
} from "./mcp-connector-compatibility.types.js";
import { DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS } from "./mcp-connector-compatibility.types.js";
import {
  DenyingToolPolicy,
  RuntimeBindingToolPolicy,
  WorkspaceScopedToolPolicy,
} from "./policies/test-tool-policies.js";
import {
  isExternalConnectorIntegrationRequired,
  missingExternalConnectorFixtureMessage,
  resolveExternalConnectorStdioEntry,
} from "./resolve-external-connector-stdio-entry.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");

interface ActiveHarnessResources {
  readonly mcpClientPool: ReturnType<typeof createMcpClientPool>;
  readonly application: ReturnType<typeof createConnectorApplication>;
  readonly workspaces: MemoryWorkspaceRepository;
  readonly connectors: MemoryConnectorRepository;
  readonly tools: MemoryToolRepository;
}

interface ConnectorHarnessState {
  fixture: McpConnectorCompatibilityFixtureContext | undefined;
  resources: ActiveHarnessResources | undefined;
}

function createIds(prefix: string) {
  let counter = 0;
  return {
    createId() {
      counter += 1;
      return `${prefix}-id-${String(counter)}`;
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

function resolveCaseStdioEntry(
  connectorCase: McpConnectorCompatibilityCase,
): string | undefined {
  return resolveExternalConnectorStdioEntry(connectorCase.stdioEntryResolution);
}

function shouldFailWhenFixtureMissing(
  connectorCase: McpConnectorCompatibilityCase,
): boolean {
  const connectorSpecific = isExternalConnectorIntegrationRequired(
    connectorCase.requireIntegrationEnvVars,
  );
  if (connectorCase.executionMode === "optional") {
    return connectorSpecific;
  }

  return (
    connectorSpecific ||
    isExternalConnectorIntegrationRequired([
      "OSVA_REQUIRE_CONNECTOR_INTEGRATION",
    ])
  );
}

function missingCaseFixtureMessage(
  connectorCase: McpConnectorCompatibilityCase,
): string {
  return missingExternalConnectorFixtureMessage({
    connectorLabel: connectorCase.connectorLabel,
    buildInstructions: connectorCase.buildInstructions,
    explicitPathEnvVars: connectorCase.stdioEntryResolution.explicitPathEnvVars,
    connectorsRootEnvVar:
      connectorCase.stdioEntryResolution.connectorsRootEnvVar,
    stdioFixtureRelativePathFromRoot:
      connectorCase.stdioEntryResolution.stdioFixtureRelativePathFromRoot,
  });
}

function authContext(
  connectorCase: McpConnectorCompatibilityCase,
  toolVersionId: ToolVersionId,
  options?: {
    readonly workspaceId?: WorkspaceId;
    readonly bindingName?: string;
  },
): ToolAuthorizationContext {
  return {
    workspaceId: options?.workspaceId ?? connectorCase.workspaceIds.primary,
    agentId: connectorCase.agentId,
    runId: connectorCase.runId,
    runAttemptId: connectorCase.runAttemptId,
    bindingName: options?.bindingName ?? connectorCase.toolImport.bindingName,
    toolVersionId,
  };
}

export function registerMcpConnectorCompatibilitySuite(
  connectorCase: McpConnectorCompatibilityCase,
): void {
  const stdioEntry = resolveCaseStdioEntry(connectorCase);
  const failWhenMissing = shouldFailWhenFixtureMissing(connectorCase);
  const describeIntegration =
    stdioEntry === undefined && !failWhenMissing ? describe.skip : describe;

  describeIntegration(
    `${connectorCase.connectorLabel} ToolGateway compatibility`,
    () => {
      const state: ConnectorHarnessState = {
        fixture: undefined,
        resources: undefined,
      };

      beforeAll(() => {
        if (stdioEntry === undefined) {
          if (failWhenMissing) {
            throw new Error(missingCaseFixtureMessage(connectorCase));
          }
          console.warn(missingCaseFixtureMessage(connectorCase));
        }
      });

      afterEach(async () => {
        if (state.resources !== undefined) {
          await state.resources.mcpClientPool.close();
          state.resources = undefined;
        }
        if (state.fixture?.close !== undefined) {
          await state.fixture.close();
        }
        state.fixture = undefined;
      });

      function createApplication(options: {
        readonly stdioConnectorsEnabled: boolean;
        readonly secrets: Readonly<Record<string, string>>;
      }): ActiveHarnessResources {
        const workspaces = new MemoryWorkspaceRepository();
        const connectors = new MemoryConnectorRepository();
        const tools = new MemoryToolRepository();
        const secretResolver = new MemorySecretResolver(options.secrets);
        const mcpClientPool = createMcpClientPool({
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
          ids: createIds(connectorCase.id),
        });

        const resources = {
          application,
          workspaces,
          connectors,
          tools,
          mcpClientPool,
        };
        state.resources = resources;
        return resources;
      }

      function stdioTransportConfig() {
        if (stdioEntry === undefined) {
          throw new Error("stdio entry is not configured.");
        }
        if (state.fixture === undefined) {
          throw new Error("fixture context is not initialized.");
        }

        return {
          command: process.execPath,
          args: [stdioEntry],
          environment: connectorCase.fixtureEnvironment(state.fixture),
          secretEnvironment: connectorCase.secrets.secretEnvironment,
        } as const;
      }

      async function registerConnector(resources: ActiveHarnessResources) {
        const scope = fakeControlPlaneScope(connectorCase.workspaceIds.primary);
        const connector = await resources.application.createConnector.execute(
          scope,
          {
            workspaceId: connectorCase.workspaceIds.primary,
            key: connectorCase.connectorKey,
            name: connectorCase.connectorDisplayName,
          },
        );
        const connectorVersion =
          await resources.application.appendConnectorVersion.execute(scope, {
            connectorId: connector.id,
            kind: "MCP",
            transport: "STDIO",
            transportConfig: stdioTransportConfig(),
          });
        return { connector, connectorVersion, scope };
      }

      async function importTool(
        resources: ActiveHarnessResources,
        scope: ReturnType<typeof fakeControlPlaneScope>,
        connectorVersionId: import("@osva-ai/contracts").ConnectorVersionId,
      ): Promise<RegisteredConnectorImport> {
        await resources.application.discoverConnectorTools.execute(scope, {
          connectorVersionId,
        });
        const imported = await resources.application.importMcpTools.execute(
          scope,
          {
            connectorVersionId,
            tools: [
              {
                remoteToolName: connectorCase.toolImport.remoteToolName,
                toolKey: connectorCase.toolImport.toolKey,
                toolName: connectorCase.toolImport.toolName,
              },
            ],
          },
        );
        const row = imported[0]!;
        return {
          toolVersionId: row.toolVersionId,
          connectorVersionId,
          createdNewToolVersion: row.createdNewToolVersion,
          remoteToolName: row.remoteToolName,
        };
      }

      async function prepareRegisteredTool(options: {
        readonly secrets: Readonly<Record<string, string>>;
        readonly stdioConnectorsEnabled?: boolean;
      }): Promise<{
        readonly resources: ActiveHarnessResources;
        readonly registered: RegisteredConnectorImport;
      }> {
        state.fixture = await connectorCase.startFixture();
        const resources = createApplication({
          stdioConnectorsEnabled: options.stdioConnectorsEnabled ?? true,
          secrets: options.secrets,
        });
        await seedWorkspaces(resources.workspaces, [
          connectorCase.workspaceIds.primary,
          connectorCase.workspaceIds.secondary,
        ]);
        const { connectorVersion, scope } = await registerConnector(resources);
        const registered = await importTool(
          resources,
          scope,
          connectorVersion.id,
        );
        return { resources, registered };
      }

      it(
        "discovers, imports, and invokes the configured MCP tool through ToolGateway",
        async () => {
          const { resources, registered } = await prepareRegisteredTool({
            secrets: {
              [connectorCase.secrets.secretRefKey]:
                connectorCase.secrets.validSecretValue,
            },
          });

          expect(registered.createdNewToolVersion).toBe(true);
          expect(registered.remoteToolName).toBe(
            connectorCase.toolImport.remoteToolName,
          );

          const storedVersion = await resources.tools.findToolVersionById(
            registered.toolVersionId,
          );
          expect(storedVersion?.type).toBe("MCP");
          expect(storedVersion?.mcp?.remoteToolName).toBe(
            connectorCase.toolImport.remoteToolName,
          );
          expect(storedVersion?.mcp?.connectorVersionId).toBe(
            registered.connectorVersionId,
          );

          const persistedConnectorVersion =
            await resources.connectors.findConnectorVersionById(
              registered.connectorVersionId,
            );
          expect(
            JSON.stringify(persistedConnectorVersion?.transportConfig),
          ).not.toContain(connectorCase.secrets.validSecretValue);

          expect(state.fixture!.getProviderRequestCount()).toBe(0);

          const gateway = new ToolGateway({
            tools: resources.tools,
            connectors: resources.connectors,
            mcpClientPool: resources.mcpClientPool,
            policy: new DefaultToolPolicy(),
          });

          const output = await gateway.invoke({
            toolVersionId: registered.toolVersionId,
            input: connectorCase.happyPathInput,
            authorization: authContext(connectorCase, registered.toolVersionId),
          });

          connectorCase.assertHappyPathOutput(output, state.fixture!);
          connectorCase.assertHappyPathSideEffects?.(state.fixture!);

          expect(state.fixture!.getProviderRequestCount()).toBe(1);

          const serialized = JSON.stringify(output);
          expect(serialized).not.toContain(
            connectorCase.secrets.validSecretValue,
          );
          expect(serialized).not.toContain(
            state.fixture!.leakedCredentialMarker,
          );
        },
        DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
      );

      it(
        "denies invocation when ToolPolicy rejects the request before MCP execution",
        async () => {
          const { resources, registered } = await prepareRegisteredTool({
            secrets: {
              [connectorCase.secrets.secretRefKey]:
                connectorCase.secrets.validSecretValue,
            },
          });

          const requestsBefore = state.fixture!.getProviderRequestCount();

          const gateway = new ToolGateway({
            tools: resources.tools,
            connectors: resources.connectors,
            mcpClientPool: resources.mcpClientPool,
            policy: new DenyingToolPolicy(),
          });

          await expect(
            gateway.invoke({
              toolVersionId: registered.toolVersionId,
              input: connectorCase.happyPathInput,
              authorization: authContext(
                connectorCase,
                registered.toolVersionId,
              ),
            }),
          ).rejects.toMatchObject({
            code: TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
          });

          expect(state.fixture!.getProviderRequestCount()).toBe(requestsBefore);
        },
        DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
      );

      it(
        "rejects unbound logical tool bindings before MCP execution",
        async () => {
          const { resources, registered } = await prepareRegisteredTool({
            secrets: {
              [connectorCase.secrets.secretRefKey]:
                connectorCase.secrets.validSecretValue,
            },
          });

          const requestsBefore = state.fixture!.getProviderRequestCount();

          const gateway = new ToolGateway({
            tools: resources.tools,
            connectors: resources.connectors,
            mcpClientPool: resources.mcpClientPool,
            policy: new RuntimeBindingToolPolicy({}),
          });

          await expect(
            gateway.invoke({
              toolVersionId: registered.toolVersionId,
              input: connectorCase.happyPathInput,
              authorization: authContext(
                connectorCase,
                registered.toolVersionId,
              ),
            }),
          ).rejects.toMatchObject({
            code: TOOL_ERROR_CODES.TOOL_BINDING_NOT_FOUND,
          });

          expect(state.fixture!.getProviderRequestCount()).toBe(requestsBefore);
        },
        DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
      );

      it(
        "fails when SecretReference resolution is missing for stdio secretEnvironment",
        async () => {
          state.fixture = await connectorCase.startFixture();
          const resources = createApplication({
            stdioConnectorsEnabled: true,
            secrets: {},
          });
          await seedWorkspaces(resources.workspaces, [
            connectorCase.workspaceIds.primary,
          ]);
          const scope = fakeControlPlaneScope(
            connectorCase.workspaceIds.primary,
          );
          const { connectorVersion } = await registerConnector(resources);

          await expect(
            resources.application.discoverConnectorTools.execute(scope, {
              connectorVersionId: connectorVersion.id,
            }),
          ).rejects.toBeInstanceOf(SecretNotFoundError);
        },
        DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
      );

      it(
        "rejects STDIO connector configuration when the operator gate is disabled",
        async () => {
          state.fixture = await connectorCase.startFixture();
          const resources = createApplication({
            stdioConnectorsEnabled: false,
            secrets: {
              [connectorCase.secrets.secretRefKey]:
                connectorCase.secrets.validSecretValue,
            },
          });
          await seedWorkspaces(resources.workspaces, [
            connectorCase.workspaceIds.primary,
          ]);
          const scope = fakeControlPlaneScope(
            connectorCase.workspaceIds.primary,
          );
          const connector = await resources.application.createConnector.execute(
            scope,
            {
              workspaceId: connectorCase.workspaceIds.primary,
              key: connectorCase.connectorKey,
              name: connectorCase.connectorDisplayName,
            },
          );

          await expect(
            resources.application.appendConnectorVersion.execute(scope, {
              connectorId: connector.id,
              kind: "MCP",
              transport: "STDIO",
              transportConfig: stdioTransportConfig(),
            }),
          ).rejects.toBeInstanceOf(StdioConnectorsDisabledError);
        },
        DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
      );

      it(
        "rejects cross-workspace connector discovery",
        async () => {
          const { resources, registered } = await prepareRegisteredTool({
            secrets: {
              [connectorCase.secrets.secretRefKey]:
                connectorCase.secrets.validSecretValue,
            },
          });
          void registered;

          const scopeB = fakeControlPlaneScope(
            connectorCase.workspaceIds.secondary,
          );
          await expect(
            resources.application.discoverConnectorTools.execute(scopeB, {
              connectorVersionId: registered.connectorVersionId,
            }),
          ).rejects.toBeInstanceOf(ConnectorVersionNotFoundError);
        },
        DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
      );

      it(
        "denies ToolGateway invocation for a foreign workspace authorization context",
        async () => {
          const { resources, registered } = await prepareRegisteredTool({
            secrets: {
              [connectorCase.secrets.secretRefKey]:
                connectorCase.secrets.validSecretValue,
            },
          });

          const requestsBefore = state.fixture!.getProviderRequestCount();

          const gateway = new ToolGateway({
            tools: resources.tools,
            connectors: resources.connectors,
            mcpClientPool: resources.mcpClientPool,
            policy: new WorkspaceScopedToolPolicy(
              connectorCase.workspaceIds.primary,
              new DefaultToolPolicy(),
            ),
          });

          await expect(
            gateway.invoke({
              toolVersionId: registered.toolVersionId,
              input: connectorCase.happyPathInput,
              authorization: authContext(
                connectorCase,
                registered.toolVersionId,
                {
                  workspaceId: connectorCase.workspaceIds.secondary,
                },
              ),
            }),
          ).rejects.toMatchObject({
            code: TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
          });

          expect(state.fixture!.getProviderRequestCount()).toBe(requestsBefore);
        },
        DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
      );

      if (connectorCase.assertInvalidCredentialsError !== undefined) {
        it(
          "returns a sanitized authorization failure for invalid provider credentials",
          async () => {
            const invalid =
              connectorCase.secrets.invalidSecretValue ??
              `${connectorCase.secrets.validSecretValue}-invalid`;
            const { resources, registered } = await prepareRegisteredTool({
              secrets: { [connectorCase.secrets.secretRefKey]: invalid },
            });

            const gateway = new ToolGateway({
              tools: resources.tools,
              connectors: resources.connectors,
              mcpClientPool: resources.mcpClientPool,
              policy: new DefaultToolPolicy(),
            });

            const rejection = await gateway
              .invoke({
                toolVersionId: registered.toolVersionId,
                input: connectorCase.happyPathInput,
                authorization: authContext(
                  connectorCase,
                  registered.toolVersionId,
                ),
              })
              .catch((error: unknown) => error);

            connectorCase.assertInvalidCredentialsError!(rejection);
            expect(String(rejection)).not.toContain(invalid);
          },
          DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
        );
      }

      it(
        "sanitizes mock provider 500 errors at the ToolGateway boundary",
        async () => {
          const { resources, registered } = await prepareRegisteredTool({
            secrets: {
              [connectorCase.secrets.secretRefKey]:
                connectorCase.secrets.validSecretValue,
            },
          });

          state.fixture!.setProviderMode("server_error");

          const gateway = new ToolGateway({
            tools: resources.tools,
            connectors: resources.connectors,
            mcpClientPool: resources.mcpClientPool,
            policy: new DefaultToolPolicy(),
          });

          const rejection = await gateway
            .invoke({
              toolVersionId: registered.toolVersionId,
              input: connectorCase.happyPathInput,
              authorization: authContext(
                connectorCase,
                registered.toolVersionId,
              ),
            })
            .catch((error) => error);

          expect(rejection).toMatchObject({
            code: TOOL_ERROR_CODES.MCP_TOOL_ERROR,
          });
          expect(String(rejection)).not.toContain(
            state.fixture!.leakedDebugMarker,
          );
        },
        DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
      );

      it(
        "aborts an in-flight MCP tool call when cancellation is signaled",
        async () => {
          const { resources, registered } = await prepareRegisteredTool({
            secrets: {
              [connectorCase.secrets.secretRefKey]:
                connectorCase.secrets.validSecretValue,
            },
          });

          state.fixture!.setProviderMode("slow");
          const version = await resources.tools.findToolVersionById(
            registered.toolVersionId,
          );
          expect(version).not.toBeNull();

          const controller = new AbortController();
          const slowDelayMs = connectorCase.cancellationSlowDelayMs ?? 30_000;
          const cancelAfterMs = 100;
          setTimeout(() => controller.abort(), cancelAfterMs);

          const rejection = await invokeMcpToolVersion(
            {
              connectors: resources.connectors,
              mcpClientPool: resources.mcpClientPool,
            },
            version!,
            {
              toolVersionId: registered.toolVersionId,
              input: connectorCase.happyPathInput,
              authorization: authContext(
                connectorCase,
                registered.toolVersionId,
              ),
            },
            { signal: controller.signal, timeoutMs: slowDelayMs },
          ).catch((error: unknown) => error);

          expect(rejection).toBeInstanceOf(ToolGatewayError);
          expect(rejection).toMatchObject({
            code: TOOL_ERROR_CODES.CONNECTOR_CANCELLED,
          });
        },
        DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS,
      );
    },
  );
}
