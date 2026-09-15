import type { ToolId, WorkspaceId } from "@osva/contracts";
import { Tool } from "@osva/domain";

import type { tools } from "../schema/tools.js";
import { toDomainDate } from "./timestamps.js";

type ToolRow = typeof tools.$inferSelect;

export function toolToRow(tool: Tool) {
  return {
    id: tool.id,
    workspaceId: tool.workspaceId,
    key: tool.key,
    name: tool.name,
    createdAt: tool.createdAt,
  };
}

export function toolFromRow(row: ToolRow): Tool {
  return Tool.create({
    id: row.id as ToolId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    createdAt: toDomainDate(row.createdAt),
  });
}
