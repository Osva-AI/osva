import type {
  WorkflowId,
  WorkflowRunId,
  WorkflowRunState,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  WorkflowRun,
  type WorkflowRunError,
} from "@osva/domain";

import type { workflowRuns } from "../schema/workflow-runs.js";
import { toDomainDate, toOptionalDomainDate } from "./timestamps.js";

type WorkflowRunRow = typeof workflowRuns.$inferSelect;

export function workflowRunToRow(workflowRun: WorkflowRun) {
  return {
    id: workflowRun.id,
    workspaceId: workflowRun.workspaceId,
    workflowId: workflowRun.workflowId,
    workflowVersionId: workflowRun.workflowVersionId,
    status: workflowRun.status,
    input: workflowRun.input,
    output: workflowRun.output ?? null,
    error: workflowRun.error ?? null,
    startedAt: workflowRun.startedAt ?? null,
    completedAt: workflowRun.completedAt ?? null,
    createdAt: workflowRun.createdAt,
    updatedAt: workflowRun.updatedAt,
  };
}

export function workflowRunFromRow(row: WorkflowRunRow): WorkflowRun {
  return WorkflowRun.rehydrate({
    id: row.id as WorkflowRunId,
    workspaceId: row.workspaceId as WorkspaceId,
    workflowId: row.workflowId as WorkflowId,
    workflowVersionId: row.workflowVersionId as WorkflowVersionId,
    status: row.status as WorkflowRunState,
    input: row.input,
    output: row.output ?? undefined,
    error: toWorkflowRunError(row.error),
    startedAt: toOptionalDomainDate(row.startedAt),
    completedAt: toOptionalDomainDate(row.completedAt),
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}

function toWorkflowRunError(value: unknown): WorkflowRunError | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError(
      "Persisted WorkflowRun.error must be an object.",
    );
  }

  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || typeof record.message !== "string") {
    throw new DomainInvariantError(
      "Persisted WorkflowRun.error must include code and message.",
    );
  }

  return { code: record.code, message: record.message };
}
