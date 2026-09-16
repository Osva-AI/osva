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
import { MCP_TOOL_IMPLEMENTATION } from "@osva/contracts";

import { Connector } from "./connector.js";
import type { ConnectorVersion } from "./connector-version.js";
import {
  ConnectorNotFoundError,
  ConnectorVersionNotFoundError,
  DuplicateConnectorKeyError,
  DuplicateToolKeyError,
  ToolNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import type { ConnectorRepository } from "./ports/connector-repository.js";
import type { ToolRepository } from "./ports/tool-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import { Tool } from "./tool.js";
import { isSameMcpToolVersionConfig } from "./tool-version.js";

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

function toConnectorVersionResource(version: ConnectorVersion) {
  return {
    id: version.id,
    connectorId: version.connectorId,
    version: version.version,
    kind: version.kind,
    transport: version.transport,
    transportConfig: version.transportConfig,
    auth: version.auth,
    createdAt: version.createdAt.toISOString(),
  };
}

export class CreateConnector {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(command: CreateConnectorCommand): Promise<Connector> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const now = this.deps.clock.now();
    const connector = Connector.create({
      id: this.deps.ids.createId() as ConnectorId,
      workspaceId: command.workspaceId,
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

  async execute(connectorId: ConnectorId): Promise<Connector> {
    const connector = await this.deps.connectors.findConnectorById(connectorId);
    if (connector === null) {
      throw new ConnectorNotFoundError(connectorId);
    }

    return connector;
  }
}

export class ListConnectors {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(): Promise<Connector[]> {
    return this.deps.connectors.listConnectors();
  }
}

export class UpdateConnectorMetadata {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(command: UpdateConnectorMetadataCommand): Promise<Connector> {
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
    command: AppendConnectorVersionCommand,
  ): Promise<ConnectorVersion> {
    const connector = await this.deps.connectors.findConnectorById(
      command.connectorId,
    );
    if (connector === null) {
      throw new ConnectorNotFoundError(command.connectorId);
    }

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
    command: GetConnectorVersionCommand,
  ): Promise<ConnectorVersion> {
    const connector = await this.deps.connectors.findConnectorById(
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

  async execute(connectorId: ConnectorId): Promise<ConnectorVersion[]> {
    const connector = await this.deps.connectors.findConnectorById(connectorId);
    if (connector === null) {
      throw new ConnectorNotFoundError(connectorId);
    }

    return this.deps.connectors.listConnectorVersions(connectorId);
  }
}

export class DiscoverConnectorTools {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    command: DiscoverConnectorToolsCommand,
  ): Promise<readonly DiscoveredMcpTool[]> {
    const version = await this.deps.connectors.findConnectorVersionById(
      command.connectorVersionId,
    );
    if (version === null) {
      throw new ConnectorVersionNotFoundError(command.connectorVersionId);
    }

    return this.deps.mcpClientPool.discoverTools(
      toConnectorVersionResource(version),
    );
  }
}

export class ImportMcpTools {
  constructor(private readonly deps: ConnectorApplicationDependencies) {}

  async execute(
    command: ImportMcpToolsCommand,
  ): Promise<readonly ImportedMcpToolResult[]> {
    const connectorVersion =
      await this.deps.connectors.findConnectorVersionById(
        command.connectorVersionId,
      );
    if (connectorVersion === null) {
      throw new ConnectorVersionNotFoundError(command.connectorVersionId);
    }

    const connector = await this.deps.connectors.findConnectorById(
      connectorVersion.connectorId,
    );
    if (connector === null) {
      throw new ConnectorNotFoundError(connectorVersion.connectorId);
    }

    const discovered = await this.deps.mcpClientPool.discoverTools(
      toConnectorVersionResource(connectorVersion),
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
  const all = await tools.listTools();
  return (
    all.find((tool) => tool.workspaceId === workspaceId && tool.key === key) ??
    null
  );
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
