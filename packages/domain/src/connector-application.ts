import type {
  ConnectorAuthConfig,
  ConnectorId,
  ConnectorKind,
  ConnectorTransport,
  ConnectorTransportConfig,
  ConnectorVersionId,
  DiscoveredMcpTool,
  McpClientPool,
  ToolId,
  ToolVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  AUTHORIZATION_ACTIONS,
  MCP_TOOL_IMPLEMENTATION,
} from "@osva/contracts";

import { Connector } from "./connector.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";

const CONNECTOR_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.connector };
import type { ConnectorVersion } from "./connector-version.js";
import {
  ConnectorNotFoundError,
  ConnectorVersionNotFoundError,
  DuplicateConnectorKeyError,
  DuplicateToolKeyError,
  StdioConnectorsDisabledError,
  ToolNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import type { ConnectorRepository } from "./ports/connector-repository.js";
import type { ToolRepository } from "./ports/tool-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import { Tool } from "./tool.js";
import { isSameMcpToolVersionConfig } from "./tool-version.js";
import { toMcpConnectorExecutionConfig } from "./mcp-connector-execution.js";

export interface McpRuntimePolicy {
  readonly stdioConnectorsEnabled: boolean;
}

function assertStdioConnectorAllowed(
  transport: ConnectorTransport,
  policy: McpRuntimePolicy,
): void {
  if (transport === "STDIO" && !policy.stdioConnectorsEnabled) {
    throw new StdioConnectorsDisabledError();
  }
}

export interface ConnectorApplicationClock {
  now(): Date;
}

export interface ConnectorApplicationIds {
  createId(): string;
}

export interface ConnectorApplicationDependencies {
  readonly connectors: ConnectorRepository;
  readonly tools: ToolRepository;
  readonly workspaces: WorkspaceRepository;
  readonly mcpClientPool: McpClientPool;
  readonly mcpRuntimePolicy: McpRuntimePolicy;
  readonly clock: ConnectorApplicationClock;
  readonly ids: ConnectorApplicationIds;
}

export interface CreateConnectorCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface UpdateConnectorMetadataCommand {
  readonly connectorId: ConnectorId;
  readonly name: string;
  readonly description?: string;
}

export interface AppendConnectorVersionCommand {
  readonly connectorId: ConnectorId;
  readonly kind: ConnectorKind;
  readonly transport: ConnectorTransport;
  readonly transportConfig: ConnectorTransportConfig;
  readonly auth?: ConnectorAuthConfig;
}

export interface GetConnectorVersionCommand {
  readonly connectorId: ConnectorId;
  readonly connectorVersionId: ConnectorVersionId;
}

export interface DiscoverConnectorToolsCommand {
  readonly connectorVersionId: ConnectorVersionId;
}

export interface ImportMcpToolCommand {
  readonly remoteToolName: string;
  readonly toolKey: string;
  readonly toolName: string;
}

export interface ImportMcpToolsCommand {
  readonly connectorVersionId: ConnectorVersionId;
  readonly tools: readonly ImportMcpToolCommand[];
}

export interface ImportedMcpToolResult {
  readonly toolId: ToolId;
  readonly toolVersionId: ToolVersionId;
  readonly remoteToolName: string;
  readonly toolKey: string;
  readonly createdNewToolVersion: boolean;
}

export class CreateConnector {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateConnectorCommand,
  ): Promise<Connector> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      CONNECTOR_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const now = this.deps.clock.now();
    const connector = Connector.create({
      id: this.deps.ids.createId() as ConnectorId,
      workspaceId,
      key: command.key,
      name: command.name,
      description: command.description,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await this.deps.connectors.saveConnector(connector);
    } catch (error) {
      if (error instanceof DuplicateConnectorKeyError) {
        throw error;
      }
      throw error;
    }

    return connector;
  }
}

export class GetConnector {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    connectorId: ConnectorId,
  ): Promise<Connector> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      CONNECTOR_RESOURCE,
    );
    const connector = await this.deps.connectors.findConnectorByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      connectorId,
    );
    if (connector === null) {
      throw new ConnectorNotFoundError(connectorId);
    }

    return connector;
  }
}

export class ListConnectors {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(scope: ControlPlaneScope): Promise<Connector[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      CONNECTOR_RESOURCE,
    );
    return this.deps.connectors.listConnectorsByWorkspaceId(
      controlPlaneWorkspaceId(scope),
    );
  }
}

export class UpdateConnectorMetadata {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: UpdateConnectorMetadataCommand,
  ): Promise<Connector> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      CONNECTOR_RESOURCE,
    );
    const existing = await this.deps.connectors.findConnectorByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      command.connectorId,
    );
    if (existing === null) {
      throw new ConnectorNotFoundError(command.connectorId);
    }

    const updated = await this.deps.connectors.updateConnectorMetadata(
      command.connectorId,
      {
        name: command.name,
        description: command.description,
        updatedAt: this.deps.clock.now(),
      },
    );
    if (updated === null) {
      throw new ConnectorNotFoundError(command.connectorId);
    }

    return updated;
  }
}

export class AppendConnectorVersion {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: AppendConnectorVersionCommand,
  ): Promise<ConnectorVersion> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      CONNECTOR_RESOURCE,
    );
    const connector = await this.deps.connectors.findConnectorByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      command.connectorId,
    );
    if (connector === null) {
      throw new ConnectorNotFoundError(command.connectorId);
    }

    assertStdioConnectorAllowed(command.transport, this.deps.mcpRuntimePolicy);

    return this.deps.connectors.appendConnectorVersion({
      id: this.deps.ids.createId() as ConnectorVersionId,
      connectorId: command.connectorId,
      kind: command.kind,
      transport: command.transport,
      transportConfig: command.transportConfig,
      auth: command.auth,
      createdAt: this.deps.clock.now(),
    });
  }
}

export class GetConnectorVersion {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: GetConnectorVersionCommand,
  ): Promise<ConnectorVersion> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      CONNECTOR_RESOURCE,
    );
    const connector = await this.deps.connectors.findConnectorByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      command.connectorId,
    );
    if (connector === null) {
      throw new ConnectorNotFoundError(command.connectorId);
    }

    const version = await this.deps.connectors.findConnectorVersionById(
      command.connectorVersionId,
    );
    if (version === null || version.connectorId !== command.connectorId) {
      throw new ConnectorVersionNotFoundError(command.connectorVersionId);
    }

    return version;
  }
}

export class ListConnectorVersions {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    connectorId: ConnectorId,
  ): Promise<ConnectorVersion[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      CONNECTOR_RESOURCE,
    );
    const connector = await this.deps.connectors.findConnectorByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      connectorId,
    );
    if (connector === null) {
      throw new ConnectorNotFoundError(connectorId);
    }

    return this.deps.connectors.listConnectorVersions(connectorId);
  }
}

export class DiscoverConnectorTools {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: DiscoverConnectorToolsCommand,
  ): Promise<readonly DiscoveredMcpTool[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.EXECUTE,
      CONNECTOR_RESOURCE,
    );
    const version = await this.deps.connectors.findConnectorVersionById(
      command.connectorVersionId,
    );
    if (version === null) {
      throw new ConnectorVersionNotFoundError(command.connectorVersionId);
    }

    const connector = await this.deps.connectors.findConnectorByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      version.connectorId,
    );
    if (connector === null) {
      throw new ConnectorVersionNotFoundError(command.connectorVersionId);
    }

    assertStdioConnectorAllowed(version.transport, this.deps.mcpRuntimePolicy);

    return this.deps.mcpClientPool.discoverTools(
      toMcpConnectorExecutionConfig(version),
    );
  }
}

export class ImportMcpTools {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: ImportMcpToolsCommand,
  ): Promise<readonly ImportedMcpToolResult[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      CONNECTOR_RESOURCE,
    );
    const connectorVersion =
      await this.deps.connectors.findConnectorVersionById(
        command.connectorVersionId,
      );
    if (connectorVersion === null) {
      throw new ConnectorVersionNotFoundError(command.connectorVersionId);
    }

    const connector = await this.deps.connectors.findConnectorByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      connectorVersion.connectorId,
    );
    if (connector === null) {
      throw new ConnectorVersionNotFoundError(command.connectorVersionId);
    }

    assertStdioConnectorAllowed(
      connectorVersion.transport,
      this.deps.mcpRuntimePolicy,
    );

    const discovered = await this.deps.mcpClientPool.discoverTools(
      toMcpConnectorExecutionConfig(connectorVersion),
    );
    const discoveredByName = new Map(
      discovered.map((tool) => [tool.remoteToolName, tool]),
    );

    const results: ImportedMcpToolResult[] = [];

    for (const item of command.tools) {
      const remote = discoveredByName.get(item.remoteToolName);
      if (remote === undefined) {
        throw new ToolNotFoundError(item.toolKey as ToolId);
      }

      let tool = await findToolByWorkspaceKey(
        this.deps.tools,
        connector.workspaceId,
        item.toolKey,
      );

      if (tool === null) {
        tool = Tool.create({
          id: this.deps.ids.createId() as ToolId,
          workspaceId: connector.workspaceId,
          key: item.toolKey,
          name: item.toolName,
          createdAt: this.deps.clock.now(),
        });

        try {
          await this.deps.tools.saveTool(tool);
        } catch (error) {
          if (error instanceof DuplicateToolKeyError) {
            tool = await findToolByWorkspaceKey(
              this.deps.tools,
              connector.workspaceId,
              item.toolKey,
            );
            if (tool === null) {
              throw error;
            }
          } else {
            throw error;
          }
        }
      }

      const existingVersions = await this.deps.tools.listToolVersions(tool.id);
      const mcpConfig = {
        connectorVersionId: connectorVersion.id,
        remoteToolName: item.remoteToolName,
        description: remote.description,
        inputSchema: remote.inputSchema,
      };

      const matching = existingVersions.find(
        (version) =>
          version.type === "MCP" &&
          version.mcp !== undefined &&
          isSameMcpToolVersionConfig(version.mcp, mcpConfig),
      );

      if (matching !== undefined) {
        results.push({
          toolId: tool.id,
          toolVersionId: matching.id,
          remoteToolName: item.remoteToolName,
          toolKey: item.toolKey,
          createdNewToolVersion: false,
        });
        continue;
      }

      const created = await this.deps.tools.appendToolVersion({
        id: this.deps.ids.createId() as ToolVersionId,
        toolId: tool.id,
        type: "MCP",
        implementation: MCP_TOOL_IMPLEMENTATION,
        mcp: mcpConfig,
        createdAt: this.deps.clock.now(),
      });

      results.push({
        toolId: tool.id,
        toolVersionId: created.id,
        remoteToolName: item.remoteToolName,
        toolKey: item.toolKey,
        createdNewToolVersion: true,
      });
    }

    return results;
  }
}

async function findToolByWorkspaceKey(
  tools: ToolRepository,
  workspaceId: WorkspaceId,
  key: string,
): Promise<Tool | null> {
  const all = await tools.listToolsByWorkspaceId(workspaceId);
  return all.find((tool) => tool.key === key) ?? null;
}

export interface ConnectorApplication {
  readonly createConnector: CreateConnector;
  readonly getConnector: GetConnector;
  readonly listConnectors: ListConnectors;
  readonly updateConnectorMetadata: UpdateConnectorMetadata;
  readonly appendConnectorVersion: AppendConnectorVersion;
  readonly getConnectorVersion: GetConnectorVersion;
  readonly listConnectorVersions: ListConnectorVersions;
  readonly discoverConnectorTools: DiscoverConnectorTools;
  readonly importMcpTools: ImportMcpTools;
}

export function createConnectorApplication(
  deps: ConnectorApplicationDependencies,
): ConnectorApplication {
  return {
    createConnector: new CreateConnector(deps),
    getConnector: new GetConnector(deps),
    listConnectors: new ListConnectors(deps),
    updateConnectorMetadata: new UpdateConnectorMetadata(deps),
    appendConnectorVersion: new AppendConnectorVersion(deps),
    getConnectorVersion: new GetConnectorVersion(deps),
    listConnectorVersions: new ListConnectorVersions(deps),
    discoverConnectorTools: new DiscoverConnectorTools(deps),
    importMcpTools: new ImportMcpTools(deps),
  };
}
