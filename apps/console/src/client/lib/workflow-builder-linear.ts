import type {
  AgentVersionId,
  WorkflowDefinitionAgentNodeV2,
} from "@osva-ai/contracts";

import type { WorkflowBuilderDraft } from "./workflow-builder-draft";
export type {
  ClientDefinitionValidation,
  ClientDefinitionValidationError,
  WorkflowBuilderDraft,
  WorkflowBuilderRegistry,
  WorkflowNodeLayout,
} from "./workflow-builder-draft";
export {
  assertNoLayoutInDefinition,
  createDraftId,
  createEmptyWorkflowBuilderDraft,
  definitionForPublish,
  setCreatedWorkflowId,
  updateRegistry,
  validateDraftForPublish,
  validateRegistryFields,
} from "./workflow-builder-draft";
export {
  analyzeWorkflowBuilderDraft,
  applyCanonicalPublishGate,
} from "./workflow-builder-validation";

import {
  addWorkflowNode,
  removeWorkflowNode,
  setAgentNodeVersion,
} from "./workflow-builder-graph";

const LAYOUT_X = 80;
const LAYOUT_Y_START = 40;
const LAYOUT_Y_STEP = 120;

function rebuildLinearEdges(
  nodeOrder: readonly string[],
): WorkflowBuilderDraft["definition"]["edges"] {
  const edges: Array<{ from: string; to: string }> = [];
  for (let index = 0; index < nodeOrder.length - 1; index += 1) {
    edges.push({ from: nodeOrder[index]!, to: nodeOrder[index + 1]! });
  }
  return edges;
}

function syncLinearLayout(
  nodeOrder: readonly string[],
  layoutByNodeKey: Readonly<
    Record<string, { readonly x: number; readonly y: number }>
  >,
): Readonly<Record<string, { readonly x: number; readonly y: number }>> {
  const next: Record<string, { x: number; y: number }> = { ...layoutByNodeKey };
  nodeOrder.forEach((key, index) => {
    next[key] = {
      x: LAYOUT_X,
      y: LAYOUT_Y_START + index * LAYOUT_Y_STEP,
    };
  });
  for (const key of Object.keys(next)) {
    if (!nodeOrder.includes(key)) {
      delete next[key];
    }
  }
  return next;
}

function nodesByKey(
  nodes: readonly WorkflowDefinitionAgentNodeV2[],
): Map<string, WorkflowDefinitionAgentNodeV2> {
  return new Map(nodes.map((node) => [node.key, node]));
}

/** @deprecated Prefer `addWorkflowNode` from workflow-builder-graph. */
export function addAgentNode(
  draft: WorkflowBuilderDraft,
  agentVersionId: AgentVersionId = "" as AgentVersionId,
): WorkflowBuilderDraft {
  let next = addWorkflowNode(draft, "AGENT");
  const key = next.nodeOrder[next.nodeOrder.length - 1];
  if (key === undefined) {
    return next;
  }
  if (agentVersionId.trim().length > 0) {
    next = setAgentNodeVersion(next, key, agentVersionId);
  }
  const nodeOrder = next.nodeOrder;
  const agentNodes = next.definition.nodes.filter(
    (node): node is WorkflowDefinitionAgentNodeV2 => node.type === "AGENT",
  );
  const byKey = nodesByKey(agentNodes);
  const nodes = nodeOrder
    .map((nodeKey) => byKey.get(nodeKey))
    .filter(
      (node): node is WorkflowDefinitionAgentNodeV2 => node !== undefined,
    );
  return {
    ...next,
    definition: {
      ...next.definition,
      nodes,
      edges: rebuildLinearEdges(nodeOrder),
    },
    layoutByNodeKey: syncLinearLayout(nodeOrder, next.layoutByNodeKey),
  };
}

/** @deprecated Prefer `removeWorkflowNode` from workflow-builder-graph. */
export function removeAgentNode(
  draft: WorkflowBuilderDraft,
  nodeKey: string,
): WorkflowBuilderDraft {
  const next = removeWorkflowNode(draft, nodeKey);
  const nodeOrder = next.nodeOrder.filter((key) => key !== nodeKey);
  const agentNodes = next.definition.nodes.filter(
    (node): node is WorkflowDefinitionAgentNodeV2 => node.type === "AGENT",
  );
  return {
    ...next,
    nodeOrder,
    definition: {
      ...next.definition,
      nodes: agentNodes,
      edges: rebuildLinearEdges(nodeOrder),
    },
    layoutByNodeKey: syncLinearLayout(nodeOrder, next.layoutByNodeKey),
  };
}

/** @deprecated Linear reorder helper for legacy tests. */
export function moveAgentNode(
  draft: WorkflowBuilderDraft,
  fromIndex: number,
  toIndex: number,
): WorkflowBuilderDraft {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= draft.nodeOrder.length ||
    toIndex >= draft.nodeOrder.length ||
    fromIndex === toIndex
  ) {
    return draft;
  }
  const nodeOrder = [...draft.nodeOrder];
  const [moved] = nodeOrder.splice(fromIndex, 1);
  if (moved === undefined) {
    return draft;
  }
  nodeOrder.splice(toIndex, 0, moved);
  const byKey = nodesByKey(
    draft.definition.nodes.filter(
      (node): node is WorkflowDefinitionAgentNodeV2 => node.type === "AGENT",
    ),
  );
  const nodes = nodeOrder
    .map((key) => byKey.get(key))
    .filter(
      (node): node is WorkflowDefinitionAgentNodeV2 => node !== undefined,
    );
  return {
    ...draft,
    nodeOrder,
    definition: {
      ...draft.definition,
      nodes,
      edges: rebuildLinearEdges(nodeOrder),
    },
    layoutByNodeKey: syncLinearLayout(nodeOrder, draft.layoutByNodeKey),
  };
}

export { setAgentNodeVersion } from "./workflow-builder-graph";

export function listAgentNodesInOrder(
  draft: WorkflowBuilderDraft,
): WorkflowDefinitionAgentNodeV2[] {
  if (draft.nodeOrder.length > 0) {
    const byKey = nodesByKey(
      draft.definition.nodes.filter(
        (node): node is WorkflowDefinitionAgentNodeV2 => node.type === "AGENT",
      ),
    );
    return draft.nodeOrder
      .map((key) => byKey.get(key))
      .filter(
        (node): node is WorkflowDefinitionAgentNodeV2 => node !== undefined,
      );
  }
  return draft.definition.nodes.filter(
    (node): node is WorkflowDefinitionAgentNodeV2 => node.type === "AGENT",
  );
}
