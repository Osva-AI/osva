import type {
  RunId,
  WorkflowNodeRunId,
  WorkflowNodeRunState,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  WorkflowNodeRun,
  type WorkflowRunError,
} from "@osva/domain";

import type { workflowNodeRuns } from "../schema/workflow-node-runs.js";
import { toDomainDate, toOptionalDomainDate } from "./timestamps.js";

type WorkflowNodeRunRow = typeof workflowNodeRuns.$inferSelect;

export function workflowNodeRunToRow(nodeRun: WorkflowNodeRun) {
  return {
    id: nodeRun.id,
    workspaceId: nodeRun.workspaceId,
    workflowRunId: nodeRun.workflowRunId,
    workflowNodeKey: nodeRun.workflowNodeKey,
    sequence: nodeRun.sequence,
    status: nodeRun.status,
    input: nodeRun.input,
    output: nodeRun.output ?? null,
    childRunId: nodeRun.childRunId ?? null,
    error: nodeRun.error ?? null,
    startedAt: nodeRun.startedAt ?? null,
    completedAt: nodeRun.completedAt ?? null,
    createdAt: nodeRun.createdAt,
    updatedAt: nodeRun.updatedAt,
  };
}

export function workflowNodeRunFromRow(
  row: WorkflowNodeRunRow,
): WorkflowNodeRun {
  return WorkflowNodeRun.rehydrate({
    id: row.id as WorkflowNodeRunId,
    workspaceId: row.workspaceId as WorkspaceId,
    workflowRunId: row.workflowRunId as WorkflowRunId,
    workflowNodeKey: row.workflowNodeKey,
    sequence: row.sequence,
    status: row.status as WorkflowNodeRunState,
    input: row.input,
    output: row.output ?? undefined,
    childRunId: (row.childRunId as RunId | null) ?? undefined,
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
      "Persisted WorkflowNodeRun.error must be an object.",
    );
  }

  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || typeof record.message !== "string") {
    throw new DomainInvariantError(
      "Persisted WorkflowNodeRun.error must include code and message.",
    );
  }

  return { code: record.code, message: record.message };
}
