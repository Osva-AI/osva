import type { RunResource } from "../hooks/use-runs";
import type { WorkflowRunSummaryResource } from "../hooks/use-workflow-runs";

export type AttentionKind = "failed" | "waiting" | "active";

export interface AttentionRunItem {
  readonly kind: "run";
  readonly id: string;
  readonly status: string;
  readonly attentionKind: AttentionKind;
  readonly agentId: string;
  readonly updatedAt: string;
}

export interface AttentionWorkflowRunItem {
  readonly kind: "workflow-run";
  readonly id: string;
  readonly status: string;
  readonly attentionKind: AttentionKind;
  readonly workflowId: string;
  readonly updatedAt: string;
}

export type AttentionItem = AttentionRunItem | AttentionWorkflowRunItem;

const RUN_FAILED = new Set(["FAILED", "TIMED_OUT"]);
const RUN_ACTIVE = new Set(["PENDING", "QUEUED", "RUNNING"]);
const WORKFLOW_FAILED = new Set(["FAILED"]);
const WORKFLOW_WAITING = new Set(["WAITING"]);
const WORKFLOW_ACTIVE = new Set(["PENDING", "RUNNING"]);

export function classifyRunAttention(
  status: string,
): AttentionKind | undefined {
  if (RUN_FAILED.has(status)) {
    return "failed";
  }
  if (RUN_ACTIVE.has(status)) {
    return "active";
  }
  return undefined;
}

export function classifyWorkflowRunAttention(
  status: string,
): AttentionKind | undefined {
  if (WORKFLOW_FAILED.has(status)) {
    return "failed";
  }
  if (WORKFLOW_WAITING.has(status)) {
    return "waiting";
  }
  if (WORKFLOW_ACTIVE.has(status)) {
    return "active";
  }
  return undefined;
}

export function collectAttentionFromRecentRuns(
  runs: readonly RunResource[],
): readonly AttentionRunItem[] {
  const items: AttentionRunItem[] = [];
  for (const run of runs) {
    const attentionKind = classifyRunAttention(run.status);
    if (attentionKind === undefined) {
      continue;
    }
    items.push({
      kind: "run",
      id: run.id,
      status: run.status,
      attentionKind,
      agentId: run.agentId,
      updatedAt: run.updatedAt,
    });
  }
  return items;
}

export function collectAttentionFromRecentWorkflowRuns(
  workflowRuns: readonly WorkflowRunSummaryResource[],
): readonly AttentionWorkflowRunItem[] {
  const items: AttentionWorkflowRunItem[] = [];
  for (const run of workflowRuns) {
    const attentionKind = classifyWorkflowRunAttention(run.status);
    if (attentionKind === undefined) {
      continue;
    }
    items.push({
      kind: "workflow-run",
      id: run.id,
      status: run.status,
      attentionKind,
      workflowId: run.workflowId,
      updatedAt: run.updatedAt,
    });
  }
  return items;
}

export function attentionKindLabel(kind: AttentionKind): string {
  switch (kind) {
    case "failed":
      return "Needs review";
    case "waiting":
      return "Waiting";
    case "active":
      return "In progress";
  }
}
