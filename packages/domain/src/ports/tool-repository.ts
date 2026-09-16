import type {
  InternalToolImplementationId,
  ToolId,
  ToolType,
  ToolVersionId,
} from "@osva/contracts";

import type { Tool } from "../tool.js";
import type { ToolVersion } from "../tool-version.js";

export interface ToolMetadataUpdate {
  readonly name: string;
}

export interface AppendToolVersionInput {
  readonly id: ToolVersionId;
  readonly toolId: ToolId;
  readonly type: ToolType;
  readonly implementation: InternalToolImplementationId;
  readonly createdAt: Date;
}

export interface ToolRepository {
  saveTool(tool: Tool): Promise<void>;
  findToolById(id: ToolId): Promise<Tool | null>;
  listTools(): Promise<Tool[]>;
  updateToolMetadata(
    id: ToolId,
    metadata: ToolMetadataUpdate,
  ): Promise<Tool | null>;
  saveToolVersion(version: ToolVersion): Promise<void>;
  appendToolVersion(input: AppendToolVersionInput): Promise<ToolVersion>;
  findToolVersionById(id: ToolVersionId): Promise<ToolVersion | null>;
  listToolVersions(toolId: ToolId): Promise<ToolVersion[]>;
}
