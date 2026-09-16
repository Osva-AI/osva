import type {
  InternalToolImplementationId,
  McpToolVersionConfig,
  ToolId,
  ToolType,
  ToolVersionId,
} from "@osva/contracts";
import { MCP_TOOL_IMPLEMENTATION } from "@osva/contracts";
import { ToolVersion } from "@osva/domain";

import type { toolVersions } from "../schema/tool-versions.js";
import { toDomainDate } from "./timestamps.js";

type ToolVersionRow = typeof toolVersions.$inferSelect;

export function toolVersionToRow(version: ToolVersion) {
  return {
    id: version.id,
    toolId: version.toolId,
    version: version.version,
    type: version.type,
    implementation: version.implementation,
    mcpConfig: version.mcp ?? null,
    createdAt: version.createdAt,
  };
}

export function toolVersionFromRow(row: ToolVersionRow): ToolVersion {
  return ToolVersion.create({
    id: row.id as ToolVersionId,
    toolId: row.toolId as ToolId,
    version: row.version,
    type: row.type as ToolType,
    implementation: row.implementation as
      InternalToolImplementationId | typeof MCP_TOOL_IMPLEMENTATION,
    mcp: (row.mcpConfig ?? undefined) as McpToolVersionConfig | undefined,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function isSameToolVersion(
  left: ToolVersion,
  right: ToolVersion,
): boolean {
  return (
    left.id === right.id &&
    left.toolId === right.toolId &&
    left.version === right.version &&
    left.type === right.type &&
    left.implementation === right.implementation &&
    JSON.stringify(left.mcp) === JSON.stringify(right.mcp) &&
    left.createdAt.getTime() === right.createdAt.getTime()
  );
}
