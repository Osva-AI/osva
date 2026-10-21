import type { WorkflowDefinitionV3 } from "@osva-ai/contracts";

import type {
  WorkflowBuilderDraft,
  WorkflowBuilderRegistry,
} from "./workflow-builder-draft";
import { createDraftId } from "./workflow-builder-draft";
import { computeAutoLayoutByNodeKey } from "./workflow-definition-graph-adapter";
import { asWorkflowDefinitionView } from "./workflow-definition";

export function computeNextNodeSequence(
  definition: WorkflowDefinitionV3,
): number {
  let max = 0;
  for (const node of definition.nodes) {
    const match = /-(\d+)$/.exec(node.key);
    if (match !== null) {
      max = Math.max(max, Number.parseInt(match[1]!, 10));
    }
  }
  return max + 1;
}

export function cloneDefinitionForDraft(
  definition: WorkflowDefinitionV3,
): WorkflowDefinitionV3 {
  return {
    schemaVersion: "3",
    nodes: definition.nodes.map((node) => ({ ...node })),
    edges: definition.edges.map((edge) => ({ ...edge })),
  };
}

export function createDraftForNewWorkflowVersion(input: {
  readonly workspaceId: string;
  readonly registry: WorkflowBuilderRegistry;
  readonly createdWorkflowId: string;
  readonly sourceVersionId: string;
  readonly definition: WorkflowDefinitionV3;
}): WorkflowBuilderDraft {
  const definition = cloneDefinitionForDraft(input.definition);
  const layoutByNodeKey = computeAutoLayoutByNodeKey(
    asWorkflowDefinitionView(definition),
  );
  return {
    draftId: createDraftId(),
    workspaceId: input.workspaceId,
    registry: { ...input.registry },
    definition,
    layoutByNodeKey,
    nodeOrder: definition.nodes.map((node) => node.key),
    nextNodeSequence: computeNextNodeSequence(definition),
    createdWorkflowId: input.createdWorkflowId,
    editContext: {
      kind: "newVersion",
      workflowId: input.createdWorkflowId,
      sourceVersionId: input.sourceVersionId,
    },
  };
}
