import type { RunResource } from "../hooks/use-runs";
import type { WorkflowRunSummaryResource } from "../hooks/use-workflow-runs";
import {
  activityExecutionStatusLabel,
  shortenResourceId,
  type ActivityFeedRow,
} from "./activity-feed";
import { runStatusCategory, workflowRunStatusCategory } from "./statuses";

export interface AgentRunHistoryRow extends ActivityFeedRow {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly contextLabel: string;
}

export interface WorkflowRunHistoryRow extends ActivityFeedRow {
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly contextLabel: string;
  readonly isWaiting: boolean;
}

export function buildAgentRunHistoryRows(
  runs: readonly RunResource[],
): readonly AgentRunHistoryRow[] {
  return runs.map((run) => {
    const agentVersionId = run.effectiveBindings.agentVersionId;
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
      agentId: run.agentId,
      agentVersionId,
      contextLabel: `Agent ${shortenResourceId(run.agentId)} · version ${shortenResourceId(agentVersionId)}`,
    };
  });
}

export function buildWorkflowRunHistoryRows(
  workflowRuns: readonly WorkflowRunSummaryResource[],
): readonly WorkflowRunHistoryRow[] {
  return workflowRuns.map((run) => ({
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
    workflowId: run.workflowId,
    workflowVersionId: run.workflowVersionId,
    contextLabel: `Workflow ${shortenResourceId(run.workflowId)} · version ${shortenResourceId(run.workflowVersionId)}`,
    isWaiting: run.status === "WAITING",
  }));
}
