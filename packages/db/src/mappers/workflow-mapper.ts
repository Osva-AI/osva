import type { WorkflowId, WorkspaceId } from "@osva/contracts";
import { Workflow } from "@osva/domain";

import type { workflows } from "../schema/workflows.js";
import { toDomainDate } from "./timestamps.js";

type WorkflowRow = typeof workflows.$inferSelect;

export function workflowToRow(workflow: Workflow) {
  return {
    id: workflow.id,
    workspaceId: workflow.workspaceId,
    key: workflow.key,
    name: workflow.name,
    description: workflow.description ?? null,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

export function workflowFromRow(row: WorkflowRow): Workflow {
  return Workflow.create({
    id: row.id as WorkflowId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}
