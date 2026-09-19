import type {
  WorkflowEventId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  WorkflowWait,
  type WorkflowWaitKind,
  type WorkflowWaitResolution,
} from "@osva/domain";

import type { workflowWaits } from "../schema/workflow-waits.js";
import { toDomainDate, toOptionalDomainDate } from "./timestamps.js";

type WorkflowWaitRow = typeof workflowWaits.$inferSelect;

export function workflowWaitToRow(wait: WorkflowWait) {
  return {
    workflowNodeRunId: wait.workflowNodeRunId,
    workspaceId: wait.workspaceId,
    workflowRunId: wait.workflowRunId,
    kind: wait.kind,
    armedAt: wait.armedAt,
    resolution: wait.resolution ?? null,
    resolvedAt: wait.resolvedAt ?? null,
    resolvedByEventId: wait.resolvedByEventId ?? null,
    wakeAt: wait.wakeAt ?? null,
    eventSource: wait.eventSource ?? null,
    eventType: wait.eventType ?? null,
    correlationKey: wait.correlationKey ?? null,
    eligibleFrom: wait.eligibleFrom ?? null,
    expiresAt: wait.expiresAt ?? null,
  };
}

export function workflowWaitResolutionToRow(wait: WorkflowWait) {
  return {
    resolution: wait.resolution ?? null,
    resolvedAt: wait.resolvedAt ?? null,
    resolvedByEventId: wait.resolvedByEventId ?? null,
  };
}

export function workflowWaitFromRow(row: WorkflowWaitRow): WorkflowWait {
  return WorkflowWait.rehydrate({
    workspaceId: row.workspaceId as WorkspaceId,
    workflowRunId: row.workflowRunId as WorkflowRunId,
    workflowNodeRunId: row.workflowNodeRunId as WorkflowNodeRunId,
    kind: row.kind as WorkflowWaitKind,
    armedAt: toDomainDate(row.armedAt),
    resolution: (row.resolution ?? undefined) as
      WorkflowWaitResolution | undefined,
    resolvedAt: toOptionalDomainDate(row.resolvedAt),
    resolvedByEventId: (row.resolvedByEventId ?? undefined) as
      WorkflowEventId | undefined,
    wakeAt: toOptionalDomainDate(row.wakeAt),
    eventSource: row.eventSource ?? undefined,
    eventType: row.eventType ?? undefined,
    correlationKey: row.correlationKey ?? undefined,
    eligibleFrom: toOptionalDomainDate(row.eligibleFrom),
    expiresAt: toOptionalDomainDate(row.expiresAt),
  });
}
