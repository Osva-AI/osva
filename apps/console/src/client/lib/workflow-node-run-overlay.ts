import type { WorkflowNodeRunResource } from "../hooks/use-workflow-runs";
import type { WorkflowDefinitionNode } from "./workflow-definition";

export const WORKFLOW_NODE_EXECUTION_STATUSES = [
  "PENDING",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;

export type WorkflowNodeExecutionStatus =
  (typeof WORKFLOW_NODE_EXECUTION_STATUSES)[number];

export function isKnownWorkflowNodeExecutionStatus(
  status: string,
): status is WorkflowNodeExecutionStatus {
  return (WORKFLOW_NODE_EXECUTION_STATUSES as readonly string[]).includes(
    status,
  );
}

export function compareWorkflowNodeRuns(
  left: WorkflowNodeRunResource,
  right: WorkflowNodeRunResource,
): number {
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt.localeCompare(right.updatedAt);
  }
  return left.id.localeCompare(right.id);
}

export function nodeRunsForKey(
  nodeRuns: readonly WorkflowNodeRunResource[],
  workflowNodeKey: string,
): WorkflowNodeRunResource[] {
  return nodeRuns
    .filter((nodeRun) => nodeRun.workflowNodeKey === workflowNodeKey)
    .sort(compareWorkflowNodeRuns);
}

export function selectLatestNodeRunByKey(
  nodeRuns: readonly WorkflowNodeRunResource[],
): Map<string, WorkflowNodeRunResource> {
  const byKey = new Map<string, WorkflowNodeRunResource>();
  for (const nodeRun of nodeRuns) {
    const existing = byKey.get(nodeRun.workflowNodeKey);
    if (
      existing === undefined ||
      compareWorkflowNodeRuns(existing, nodeRun) < 0
    ) {
      byKey.set(nodeRun.workflowNodeKey, nodeRun);
    }
  }
  return byKey;
}

/**
 * Maps V3 node keys to the latest persisted WorkflowNodeRun status.
 * Keys without a record are omitted — the overlay never invents success or failure.
 */
export function executionStatusByNodeKey(
  nodeRuns: readonly WorkflowNodeRunResource[],
): Readonly<Record<string, string>> {
  const latest = selectLatestNodeRunByKey(nodeRuns);
  const statuses: Record<string, string> = {};
  for (const [key, nodeRun] of latest) {
    statuses[key] = nodeRun.status;
  }
  return statuses;
}

export function describeWorkflowWaitReason(
  node: WorkflowDefinitionNode,
  nodeRun: WorkflowNodeRunResource | undefined,
): string | undefined {
  if (nodeRun?.status !== "WAITING") {
    return undefined;
  }

  if (node.type === "APPROVAL") {
    return `Waiting for a human approval decision on ${node.key}.`;
  }

  if (node.type === "WAIT" && node.wait !== undefined) {
    const wait = node.wait as {
      readonly kind?: string;
      readonly source?: string;
      readonly eventType?: string;
      readonly durationMs?: number;
      readonly until?: string;
    };
    if (wait.kind === "EVENT") {
      return `Waiting for event ${String(wait.source ?? "")}/${String(wait.eventType ?? "")} on ${node.key}.`;
    }
    if (wait.kind === "DURATION") {
      return `Waiting for a duration of ${String(wait.durationMs)} ms on ${node.key}.`;
    }
    if (wait.kind === "UNTIL") {
      return `Waiting until ${String(wait.until ?? "")} on ${node.key}.`;
    }
  }

  return `Waiting at ${node.key} (${node.type}).`;
}
