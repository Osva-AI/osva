import type { ToolId, ToolVersionId, WorkspaceId } from "./ids.js";
import type {
  InternalToolImplementationId,
  McpToolVersionConfig,
  ToolType,
} from "./tool-gateway.js";

export interface CreateToolRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
}

export interface UpdateToolRequestV1 {
  readonly name: string;
}

export interface CreateToolVersionRequestV1 {
  readonly type: ToolType;
  readonly implementation: InternalToolImplementationId;
}

export interface ToolResourceV1 {
  readonly id: ToolId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface ToolListResourceV1 {
  readonly tools: readonly ToolResourceV1[];
}

export interface InternalToolVersionResourceV1 {
  readonly id: ToolVersionId;
  readonly toolId: ToolId;
  readonly version: number;
  readonly type: "INTERNAL";
  readonly implementation: InternalToolImplementationId;
  readonly createdAt: string;
}

export interface McpToolVersionResourceV1 {
  readonly id: ToolVersionId;
  readonly toolId: ToolId;
  readonly version: number;
  readonly type: "MCP";
  readonly implementation: "MCP_V1";
  readonly mcp: McpToolVersionConfig;
  readonly createdAt: string;
}

export type ToolVersionResourceV1 =
  InternalToolVersionResourceV1 | McpToolVersionResourceV1;

export interface ToolVersionListResourceV1 {
  readonly versions: readonly ToolVersionResourceV1[];
}
