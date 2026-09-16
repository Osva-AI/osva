import type { WorkflowDefinitionBranchNodeV2 } from "@osva/contracts";
import { isTerminalWorkflowNodeRunState } from "./workflow-node-run-state-machine.js";
import type { WorkflowNodeRun } from "./workflow-node-run.js";
import {
  predecessorKeysInDefinitionOrder,
  type WorkflowGraph,
} from "./workflow-definition.js";

export function nodeRunsByKey(
  nodeRuns: readonly WorkflowNodeRun[],
): Map<string, WorkflowNodeRun> {
  const byKey = new Map<string, WorkflowNodeRun>();
  for (const nodeRun of nodeRuns) {
    byKey.set(nodeRun.workflowNodeKey, nodeRun);
  }

  return byKey;
}

export function isNodeSkippable(
  graph: WorkflowGraph,
  nodeKey: string,
  nodeRuns: ReadonlyMap<string, WorkflowNodeRun>,
): boolean {
  const incoming = graph.incoming.get(nodeKey) ?? [];
  if (incoming.length === 0) {
    return false;
  }

  return incoming.every(
    (predecessor) =>
      predecessorActivity(graph, predecessor, nodeKey, nodeRuns) === "inactive",
  );
}

export function isNodeReady(
  graph: WorkflowGraph,
  nodeKey: string,
  nodeRuns: ReadonlyMap<string, WorkflowNodeRun>,
): boolean {
  const existing = nodeRuns.get(nodeKey);
  if (
    existing !== undefined &&
    isTerminalWorkflowNodeRunState(existing.status)
  ) {
    return false;
  }

  if (isNodeSkippable(graph, nodeKey, nodeRuns)) {
    return false;
  }

  const node = graph.nodesByKey.get(nodeKey);
  if (node === undefined) {
    return false;
  }

  const incoming = predecessorKeysInDefinitionOrder(graph, nodeKey);

  if (node.type === "JOIN") {
    if (
      incoming.some((predecessor) => {
        const run = nodeRuns.get(predecessor);
        return run === undefined || !isTerminalWorkflowNodeRunState(run.status);
      })
    ) {
      return false;
    }

    if (
      incoming.some(
        (predecessor) => nodeRuns.get(predecessor)?.status === "FAILED",
      )
    ) {
      return false;
    }

    return incoming.some(
      (predecessor) => nodeRuns.get(predecessor)?.status === "SUCCEEDED",
    );
  }

  if (incoming.length === 0) {
    return true;
  }

  const predecessor = nodeRuns.get(incoming[0] ?? "");
  return predecessor?.status === "SUCCEEDED";
}

export function inputForNode(
  graph: WorkflowGraph,
  nodeKey: string,
  nodeRuns: ReadonlyMap<string, WorkflowNodeRun>,
  workflowInput: unknown,
): unknown {
  const incoming = predecessorKeysInDefinitionOrder(graph, nodeKey);
  const node = graph.nodesByKey.get(nodeKey);

  if (incoming.length === 0) {
    return workflowInput;
  }

  if (node?.type === "JOIN") {
    const joined: Record<string, unknown> = {};
    for (const predecessor of incoming) {
      const run = nodeRuns.get(predecessor);
      if (run?.status === "SUCCEEDED") {
        joined[predecessor] = run.output ?? null;
      }
    }

    return joined;
  }

  const predecessor = nodeRuns.get(incoming[0] ?? "");
  if (predecessor?.status === "SUCCEEDED") {
    return predecessor.output ?? null;
  }

  return predecessor?.input ?? workflowInput;
}

export function hasFailedNode(
  nodeRuns: ReadonlyMap<string, WorkflowNodeRun>,
): WorkflowNodeRun | undefined {
  for (const nodeRun of nodeRuns.values()) {
    if (nodeRun.status === "FAILED") {
      return nodeRun;
    }
  }

  return undefined;
}

function predecessorActivity(
  graph: WorkflowGraph,
  predecessorKey: string,
  nodeKey: string,
  nodeRuns: ReadonlyMap<string, WorkflowNodeRun>,
): "active" | "inactive" | "undecided" | "failed" {
  const predecessor = nodeRuns.get(predecessorKey);
  if (predecessor === undefined) {
    return "undecided";
  }

  if (predecessor.status === "FAILED") {
    return "failed";
  }

  if (predecessor.status === "SKIPPED") {
    return "inactive";
  }

  if (predecessor.status !== "SUCCEEDED") {
    return "undecided";
  }

  const predecessorNode = graph.nodesByKey.get(predecessorKey);
  if (predecessorNode?.type === "BRANCH") {
    const branch = predecessorNode as WorkflowDefinitionBranchNodeV2;
    if (predecessor.selectedTargetKey === nodeKey) {
      return "active";
    }

    if (
      predecessor.selectedTargetKey === undefined &&
      branch.defaultTo === nodeKey
    ) {
      return "undecided";
    }

    return predecessor.selectedTargetKey === undefined
      ? "undecided"
      : "inactive";
  }

  return "active";
}
