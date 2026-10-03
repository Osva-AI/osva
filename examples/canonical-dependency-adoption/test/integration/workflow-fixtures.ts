import type { WorkflowDefinitionV3 } from "@osva-ai/contracts";

import {
  loadReferenceWorkflowDefinition,
  materializeWorkflowDefinition,
  type WorkflowAgentVersionIds,
} from "../../scripts/lib/workflow.js";

export async function loadCanonicalWorkflowDefinition(
  agentVersionIds: WorkflowAgentVersionIds,
  options?: { readonly deliveryWaitTimeoutMs?: number },
): Promise<WorkflowDefinitionV3> {
  const reference = await loadReferenceWorkflowDefinition();
  const definition = materializeWorkflowDefinition(reference, agentVersionIds);
  if (options?.deliveryWaitTimeoutMs === undefined) {
    return definition;
  }

  const cloned = JSON.parse(JSON.stringify(definition)) as WorkflowDefinitionV3;
  const deliveryWait = cloned.nodes.find(
    (node) => node.key === "delivery-wait",
  );
  if (
    deliveryWait === undefined ||
    deliveryWait.type !== "WAIT" ||
    deliveryWait.wait.kind !== "EVENT"
  ) {
    throw new Error("Canonical workflow is missing delivery-wait EVENT node.");
  }
  return {
    ...cloned,
    nodes: cloned.nodes.map((node) => {
      if (
        node.key !== "delivery-wait" ||
        node.type !== "WAIT" ||
        node.wait.kind !== "EVENT"
      ) {
        return node;
      }
      return {
        ...node,
        wait: {
          ...node.wait,
          timeoutMs: options.deliveryWaitTimeoutMs,
        },
      };
    }),
  };
}
