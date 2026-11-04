import type { WorkflowNodeRunResource } from "../hooks/use-workflow-runs";
import {
  orderWorkflowNodeKeys,
  type WorkflowDefinitionView,
} from "./workflow-definition";
import { selectLatestNodeRunByKey } from "./workflow-node-run-overlay";
export function findPrimaryWaitingNodeKey(input: {
  readonly definition: WorkflowDefinitionView;
  readonly nodeRuns: readonly WorkflowNodeRunResource[];
}): string | undefined {
  const waitingRuns = input.nodeRuns.filter(
    (record) => record.status === "WAITING",
  );
  if (waitingRuns.length === 0) {
    return undefined;
  }
  const approval = waitingRuns.find((record) => {
    const node = input.definition.nodes.find(
      (entry) => entry.key === record.workflowNodeKey,
    );
    return node?.type === "APPROVAL";
  });
  if (approval !== undefined) {
    return approval.workflowNodeKey;
  }
  const eventWait = waitingRuns.find((record) => {
    const node = input.definition.nodes.find(
      (entry) => entry.key === record.workflowNodeKey,
    );
    return (
      node?.type === "WAIT" &&
      typeof node.wait === "object" &&
      node.wait !== null &&
      "kind" in node.wait &&
      (node.wait as { kind: string }).kind === "EVENT"
    );
  });
  if (eventWait !== undefined) {
    return eventWait.workflowNodeKey;
  }
  return waitingRuns[0]?.workflowNodeKey;
}

export function inferDefaultSelectedNodeKey(input: {
  readonly runStatus: string;
  readonly definition: WorkflowDefinitionView;
  readonly nodeRuns: readonly WorkflowNodeRunResource[];
}): string | undefined {
  const { runStatus, definition, nodeRuns } = input;

  if (runStatus === "WAITING") {
    return findPrimaryWaitingNodeKey({ definition, nodeRuns });
  }

  if (runStatus === "FAILED") {
    return nodeRuns.find((record) => record.status === "FAILED")
      ?.workflowNodeKey;
  }

  if (runStatus === "RUNNING") {
    return nodeRuns.find((record) => record.status === "RUNNING")
      ?.workflowNodeKey;
  }

  if (runStatus === "SUCCEEDED" || runStatus === "CANCELLED") {
    const latest = selectLatestNodeRunByKey(nodeRuns);
    const ordered = orderWorkflowNodeKeys(definition);
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const key = ordered[index]!;
      const record = latest.get(key);
      if (record !== undefined) {
        return key;
      }
    }
  }

  return undefined;
}
