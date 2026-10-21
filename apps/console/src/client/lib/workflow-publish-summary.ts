import type {
  WorkflowDefinitionNodeV3,
  WorkflowDefinitionV3,
} from "@osva-ai/contracts";

import { resolveWorkflowCanvasLabel } from "./workflow-canvas-labels";
import type { WorkflowCanvasLabelContext } from "./workflow-canvas-labels";
import { workflowNodePresentation } from "./workflow-node-catalog";
import { describeWaitConfiguration } from "./workflow-wait-editor";
import {
  asWorkflowDefinitionView,
  orderWorkflowNodeKeys,
} from "./workflow-definition";

export interface WorkflowPublishStepSummary {
  readonly nodeKey: string;
  readonly type: string;
  readonly presentationLabel: string;
  readonly detail: string;
}

export function buildWorkflowPublishStepSummaries(
  definition: WorkflowDefinitionV3,
  labelContext: WorkflowCanvasLabelContext,
): readonly WorkflowPublishStepSummary[] {
  const view = asWorkflowDefinitionView(definition);
  const ordered = orderWorkflowNodeKeys(view);
  const nodesByKey = new Map(definition.nodes.map((node) => [node.key, node]));

  return ordered.flatMap((key) => {
    const node = nodesByKey.get(key);
    if (node === undefined) {
      return [];
    }
    return [summarizePublishStep(node, labelContext)];
  });
}

function summarizePublishStep(
  node: WorkflowDefinitionNodeV3,
  labelContext: WorkflowCanvasLabelContext,
): WorkflowPublishStepSummary {
  const presentationLabel = resolveWorkflowCanvasLabel(node, labelContext);
  const typeLabel = workflowNodePresentation(node.type).label;

  if (node.type === "BRANCH") {
    const caseSummary =
      node.cases.length === 0
        ? "No decision cases configured."
        : node.cases
            .map(
              (branchCase) => `${String(branchCase.equals)} → ${branchCase.to}`,
            )
            .join("; ");
    return {
      nodeKey: node.key,
      type: typeLabel,
      presentationLabel,
      detail: `Field ${node.selector}. Cases: ${caseSummary}. Default: ${node.defaultTo || "(missing)"}.`,
    };
  }

  if (node.type === "APPROVAL") {
    return {
      nodeKey: node.key,
      type: typeLabel,
      presentationLabel,
      detail: node.description ?? "Human approval required before continuing.",
    };
  }

  if (node.type === "WAIT") {
    return {
      nodeKey: node.key,
      type: typeLabel,
      presentationLabel,
      detail: `${describeWaitConfiguration(node.wait)}. Execution resumes automatically when the wait completes or the event arrives.`,
    };
  }

  if (node.type === "PARALLEL") {
    return {
      nodeKey: node.key,
      type: typeLabel,
      presentationLabel,
      detail:
        "Fork step. Connect one incoming edge and two or more outgoing edges to parallel paths.",
    };
  }

  if (node.type === "JOIN") {
    return {
      nodeKey: node.key,
      type: typeLabel,
      presentationLabel,
      detail:
        "Merge step. Connect incoming edges from parallel paths and one outgoing edge to continue.",
    };
  }

  return {
    nodeKey: node.key,
    type: typeLabel,
    presentationLabel,
    detail:
      node.agentVersionId.trim().length > 0
        ? `Runs immutable AgentVersion ${node.agentVersionId}.`
        : "Agent version not selected.",
  };
}
