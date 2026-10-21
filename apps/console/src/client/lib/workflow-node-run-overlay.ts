import type { WorkflowNodeRunResource } from "../hooks/use-workflow-runs";
import {
  incomingNodeKeys,
  outgoingNodeKeys,
  workflowEdgeId,
  type WorkflowDefinitionNode,
  type WorkflowDefinitionView,
} from "./workflow-definition";

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
    return `Waiting for human approval (${node.key}).`;
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
      return `Waiting for external event ${String(wait.source ?? "")}/${String(wait.eventType ?? "")} (${node.key}).`;
    }
    if (wait.kind === "DURATION") {
      return `Waiting for a timer (${node.key}).`;
    }
    if (wait.kind === "UNTIL") {
      return `Waiting until ${String(wait.until ?? "")} (${node.key}).`;
    }
  }

  return `Waiting at ${node.key}.`;
}

export const WORKFLOW_SUSPENDED_COPY =
  "The workflow is suspended. Workers are not kept alive for this wait.";

export function describeWorkflowSuspension(
  node: WorkflowDefinitionNode,
  nodeRun: WorkflowNodeRunResource | undefined,
): string | undefined {
  const reason = describeWorkflowWaitReason(node, nodeRun);
  if (reason === undefined) {
    return undefined;
  }
  return `${reason} ${WORKFLOW_SUSPENDED_COPY}`;
}

export type WorkflowEdgeExecutionAppearance =
  "selected" | "inactive" | "skipped";

export interface PersistedNeighborStatus {
  readonly key: string;
  readonly status: string | undefined;
}

/**
 * Edge appearance is taken only from persisted BRANCH.selectedTargetKey and
 * persisted SKIPPED target records. Topology never implies a selected path.
 */
export function edgeAppearanceById(
  definition: WorkflowDefinitionView,
  nodeRuns: readonly WorkflowNodeRunResource[],
): Readonly<Record<string, WorkflowEdgeExecutionAppearance>> {
  const latest = selectLatestNodeRunByKey(nodeRuns);
  const appearances: Record<string, WorkflowEdgeExecutionAppearance> = {};

  for (const edge of definition.edges) {
    const id = workflowEdgeId(edge.from, edge.to);
    const source = definition.nodes.find((node) => node.key === edge.from);
    const sourceRun = latest.get(edge.from);
    const targetRun = latest.get(edge.to);
    const selectedTarget = sourceRun?.selectedTargetKey?.trim() ?? "";

    if (source?.type === "BRANCH" && selectedTarget.length > 0) {
      appearances[id] = selectedTarget === edge.to ? "selected" : "inactive";
    }

    if (targetRun?.status === "SKIPPED" && appearances[id] !== "selected") {
      appearances[id] = "skipped";
    }
  }

  return appearances;
}

export function persistedNeighborStatuses(
  keys: readonly string[],
  latest: ReadonlyMap<string, WorkflowNodeRunResource>,
): readonly PersistedNeighborStatus[] {
  return keys.map((key) => ({
    key,
    status: latest.get(key)?.status,
  }));
}

export function joinPredecessorStatuses(
  definition: WorkflowDefinitionView,
  nodeKey: string,
  nodeRuns: readonly WorkflowNodeRunResource[],
): readonly PersistedNeighborStatus[] {
  return persistedNeighborStatuses(
    incomingNodeKeys(definition, nodeKey),
    selectLatestNodeRunByKey(nodeRuns),
  );
}

export function parallelChildStatuses(
  definition: WorkflowDefinitionView,
  nodeKey: string,
  nodeRuns: readonly WorkflowNodeRunResource[],
): readonly PersistedNeighborStatus[] {
  return persistedNeighborStatuses(
    outgoingNodeKeys(definition, nodeKey),
    selectLatestNodeRunByKey(nodeRuns),
  );
}

export function branchOutgoingStatuses(
  definition: WorkflowDefinitionView,
  nodeKey: string,
  nodeRuns: readonly WorkflowNodeRunResource[],
): {
  readonly selectedTargetKey: string | undefined;
  readonly neighbors: readonly PersistedNeighborStatus[];
} {
  const latest = selectLatestNodeRunByKey(nodeRuns);
  return {
    selectedTargetKey: latest.get(nodeKey)?.selectedTargetKey,
    neighbors: persistedNeighborStatuses(
      outgoingNodeKeys(definition, nodeKey),
      latest,
    ),
  };
}
