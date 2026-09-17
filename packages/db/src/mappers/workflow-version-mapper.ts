import type {
  WorkflowDefinition,
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";
import { DomainInvariantError, WorkflowVersion } from "@osva/domain";

import type { workflowVersions } from "../schema/workflow-versions.js";
import { canonicalJson } from "./canonical-json.js";
import { toDomainDate } from "./timestamps.js";

type WorkflowVersionRow = typeof workflowVersions.$inferSelect;

export function workflowVersionToRow(workflowVersion: WorkflowVersion) {
  return {
    id: workflowVersion.id,
    workflowId: workflowVersion.workflowId,
    workspaceId: workflowVersion.workspaceId,
    version: workflowVersion.version,
    definition: asJsonObject(workflowVersion.definition),
    createdAt: workflowVersion.createdAt,
  };
}

export function workflowVersionFromRow(
  row: WorkflowVersionRow,
): WorkflowVersion {
  return WorkflowVersion.create({
    id: row.id as WorkflowVersionId,
    workflowId: row.workflowId as WorkflowId,
    workspaceId: row.workspaceId as WorkspaceId,
    version: row.version,
    definition: toDefinition(row.definition),
    createdAt: toDomainDate(row.createdAt),
  });
}

export function isSameWorkflowVersion(
  left: WorkflowVersion,
  right: WorkflowVersion,
): boolean {
  return (
    left.id === right.id &&
    left.workflowId === right.workflowId &&
    left.workspaceId === right.workspaceId &&
    left.version === right.version &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    canonicalJson(left.definition) === canonicalJson(right.definition)
  );
}

function toDefinition(value: unknown): WorkflowDefinition {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError(
      "Persisted WorkflowVersion.definition must be an object.",
    );
  }

  return value as WorkflowDefinition;
}

function asJsonObject(value: object): Readonly<Record<string, unknown>> {
  return value as Readonly<Record<string, unknown>>;
}
