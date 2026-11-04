import type { RunResource } from "../hooks/use-runs";
import type { WorkflowRunSummaryResource } from "../hooks/use-workflow-runs";
import {
  runStatusCategory,
  workflowRunStatusCategory,
  type StatusVisualCategory,
} from "./statuses";

export const ACTIVITY_RECENT_LIMIT = 25;

export type ActivityFeedRowKind = "agent" | "workflow";

export interface ActivityFeedRow {
  readonly id: string;
  readonly kind: ActivityFeedRowKind;
  readonly status: string;
  readonly statusLabel: string;
  readonly statusCategory: StatusVisualCategory;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly href: string;
  readonly title: string;
  readonly shortId: string;
}

/** User-facing execution status on Activity — distinct from Home attention labels. */
export function activityExecutionStatusLabel(status: string): string {
  switch (status) {
    case "FAILED":
      return "Failed";
    case "TIMED_OUT":
      return "Timed out";
    case "WAITING":
      return "Waiting";
    case "RUNNING":
      return "Running";
    case "QUEUED":
      return "Queued";
    case "PENDING":
      return "Pending";
    case "SUCCEEDED":
      return "Succeeded";
    case "CANCELLED":
      return "Cancelled";
    case "SKIPPED":
      return "Skipped";
    default: {
      const normalized = status.replaceAll("_", " ").toLowerCase();
      if (normalized.length === 0) {
        return "Unknown";
      }
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
  }
}

export function shortenResourceId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 14) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

function agentRunToRow(run: RunResource): ActivityFeedRow {
  return {
    id: run.id,
    kind: "agent",
    status: run.status,
    statusLabel: activityExecutionStatusLabel(run.status),
    statusCategory: runStatusCategory(run.status),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    href: `/runs/${encodeURIComponent(run.id)}`,
    title: "Agent run",
    shortId: shortenResourceId(run.id),
  };
}

function workflowRunToRow(run: WorkflowRunSummaryResource): ActivityFeedRow {
  return {
    id: run.id,
    kind: "workflow",
    status: run.status,
    statusLabel: activityExecutionStatusLabel(run.status),
    statusCategory: workflowRunStatusCategory(run.status),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    href: `/workflow-runs/${encodeURIComponent(run.id)}`,
    title: "Workflow run",
    shortId: shortenResourceId(run.id),
  };
}

/** Matches list API ordering: createdAt DESC, then kind, then id. */
export function compareActivityFeedRows(
  left: ActivityFeedRow,
  right: ActivityFeedRow,
): number {
  const createdDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }
  if (left.kind !== right.kind) {
    return left.kind === "agent" ? -1 : 1;
  }
  return left.id.localeCompare(right.id);
}

export function buildActivityFeedRows(input: {
  readonly agentRuns: readonly RunResource[];
  readonly workflowRuns: readonly WorkflowRunSummaryResource[];
}): readonly ActivityFeedRow[] {
  const rows: ActivityFeedRow[] = [
    ...input.agentRuns.map(agentRunToRow),
    ...input.workflowRuns.map(workflowRunToRow),
  ];
  return rows.sort(compareActivityFeedRows);
}
