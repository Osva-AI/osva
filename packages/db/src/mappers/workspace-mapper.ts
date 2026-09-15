import type { WorkspaceId } from "@osva/contracts";
import { Workspace } from "@osva/domain";

import type { workspaces } from "../schema/workspaces.js";
import { toDomainDate } from "./timestamps.js";

type WorkspaceRow = typeof workspaces.$inferSelect;

export function workspaceToRow(workspace: Workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
  };
}

export function workspaceFromRow(row: WorkspaceRow): Workspace {
  return Workspace.create({
    id: row.id as WorkspaceId,
    name: row.name,
    createdAt: toDomainDate(row.createdAt),
  });
}
