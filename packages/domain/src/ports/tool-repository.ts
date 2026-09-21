import type {
  InternalToolImplementationId,
  McpToolVersionConfig,
  ToolId,
  ToolType,
  ToolVersionId,
  WorkspaceId,
} from "@osva/contracts";
import { MCP_TOOL_IMPLEMENTATION } from "@osva/contracts";

import type { Tool } from "../tool.js";
import type { ToolVersion } from "../tool-version.js";

export interface ToolMetadataUpdate {
  readonly name: string;
}

export interface AppendToolVersionInput {
  readonly id: ToolVersionId;
  readonly toolId: ToolId;
  readonly type: ToolType;
  readonly implementation:
    InternalToolImplementationId | typeof MCP_TOOL_IMPLEMENTATION;
  readonly mcp?: McpToolVersionConfig;
  readonly createdAt: Date;
}

export interface ToolRepository {
  saveTool(tool: Tool): Promise<void>;
  findToolById(id: ToolId): Promise<Tool | null>;
  findToolByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ToolId,
  ): Promise<Tool | null>;
  listTools(): Promise<Tool[]>;
  listToolsByWorkspaceId(workspaceId: WorkspaceId): Promise<Tool[]>;
  updateToolMetadata(
    id: ToolId,
    metadata: ToolMetadataUpdate,
  ): Promise<Tool | null>;
  saveToolVersion(version: ToolVersion): Promise<void>;
  appendToolVersion(input: AppendToolVersionInput): Promise<ToolVersion>;
  findToolVersionById(id: ToolVersionId): Promise<ToolVersion | null>;
  listToolVersions(toolId: ToolId): Promise<ToolVersion[]>;
}
