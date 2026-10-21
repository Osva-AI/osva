import type { WorkflowDefinitionNodeV3 } from "@osva-ai/contracts";

import { describeWaitConfiguration } from "./workflow-wait-editor";
import { workflowNodePresentation } from "./workflow-node-catalog";

export interface WorkflowCanvasLabelContext {
  readonly agentNameByVersionId: Readonly<Record<string, string>>;
  readonly agentVersionNumberByVersionId: Readonly<Record<string, number>>;
}

export function resolveWorkflowCanvasLabel(
  node: WorkflowDefinitionNodeV3,
  context: WorkflowCanvasLabelContext = {
    agentNameByVersionId: {},
    agentVersionNumberByVersionId: {},
  },
): string {
  if (node.type === "AGENT") {
    const versionId = node.agentVersionId.trim();
    if (versionId.length === 0) {
      return "Choose an agent version";
    }
    const agentName = context.agentNameByVersionId[versionId];
    const versionNumber = context.agentVersionNumberByVersionId[versionId];
    if (agentName !== undefined && versionNumber !== undefined) {
      return `${agentName} (v${String(versionNumber)})`;
    }
    if (agentName !== undefined) {
      return agentName;
    }
    return "Agent version unavailable";
  }
  if (node.type === "APPROVAL") {
    const title = node.title.trim();
    return title.length > 0
      ? title
      : workflowNodePresentation("APPROVAL").label;
  }
  if (node.type === "BRANCH") {
    const selector = node.selector.trim();
    return selector.length > 0
      ? `Decision on ${selector}`
      : workflowNodePresentation("BRANCH").label;
  }
  if (node.type === "WAIT") {
    return describeWaitConfiguration(node.wait);
  }
  if (node.type === "PARALLEL") {
    return workflowNodePresentation("PARALLEL").label;
  }
  return workflowNodePresentation(node.type).label;
}
