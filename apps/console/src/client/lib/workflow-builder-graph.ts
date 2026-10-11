import type {
  AgentVersionId,
  WorkflowDefinitionAgentNodeV2,
  WorkflowDefinitionNodeV3,
  WorkflowDefinitionV3,
  WorkflowV3NodeType,
} from "@osva-ai/contracts";

import type {
  WorkflowBuilderDraft,
  WorkflowNodeLayout,
} from "./workflow-builder-draft";

const SPAWN_X = 80;
const SPAWN_Y = 60;
const SPAWN_STAGGER = 48;

function nodeKeyPrefix(type: WorkflowV3NodeType): string {
  switch (type) {
    case "AGENT":
      return "agent-step";
    case "BRANCH":
      return "branch";
    case "PARALLEL":
      return "parallel";
    case "JOIN":
      return "join";
    case "APPROVAL":
      return "approval";
    case "WAIT":
      return "wait";
  }
}

export function allocateWorkflowNodeKey(
  draft: WorkflowBuilderDraft,
  type: WorkflowV3NodeType,
): { readonly key: string; readonly nextNodeSequence: number } {
  const sequence = draft.nextNodeSequence;
  return {
    key: `${nodeKeyPrefix(type)}-${sequence}`,
    nextNodeSequence: sequence + 1,
  };
}

function defaultSpawnLayout(draft: WorkflowBuilderDraft): WorkflowNodeLayout {
  const index = draft.definition.nodes.length;
  return {
    x: SPAWN_X + (index % 4) * SPAWN_STAGGER,
    y: SPAWN_Y + Math.floor(index / 4) * SPAWN_STAGGER,
  };
}

export function createDefaultWorkflowNode(
  type: WorkflowV3NodeType,
  key: string,
): WorkflowDefinitionNodeV3 {
  switch (type) {
    case "AGENT":
      return { key, type: "AGENT", agentVersionId: "" as AgentVersionId };
    case "BRANCH":
      return {
        key,
        type: "BRANCH",
        selector: "/",
        cases: [],
        defaultTo: "",
      };
    case "PARALLEL":
      return { key, type: "PARALLEL" };
    case "JOIN":
      return { key, type: "JOIN" };
    case "APPROVAL":
      return { key, type: "APPROVAL", title: "Approval" };
    case "WAIT":
      return {
        key,
        type: "WAIT",
        wait: { kind: "DURATION", durationMs: 60_000 },
      };
  }
}

function edgeIdentity(from: string, to: string): string {
  return `${from}\0${to}`;
}

function hasEdge(
  edges: readonly WorkflowDefinitionV3["edges"][number][],
  from: string,
  to: string,
): boolean {
  return edges.some((edge) => edge.from === from && edge.to === to);
}

function pruneBranchReferences(
  node: WorkflowDefinitionNodeV3,
  removedKeys: ReadonlySet<string>,
): WorkflowDefinitionNodeV3 {
  if (node.type !== "BRANCH") {
    return node;
  }
  const cases = node.cases.filter(
    (branchCase) => !removedKeys.has(branchCase.to),
  );
  const defaultTo = removedKeys.has(node.defaultTo) ? "" : node.defaultTo;
  return { ...node, cases, defaultTo };
}

export function addWorkflowNode(
  draft: WorkflowBuilderDraft,
  type: WorkflowV3NodeType,
  layout?: WorkflowNodeLayout,
): WorkflowBuilderDraft {
  const { key, nextNodeSequence } = allocateWorkflowNodeKey(draft, type);
  const node = createDefaultWorkflowNode(type, key);
  const position = layout ?? defaultSpawnLayout(draft);
  return {
    ...draft,
    nextNodeSequence,
    definition: {
      ...draft.definition,
      nodes: [...draft.definition.nodes, node],
    },
    layoutByNodeKey: {
      ...draft.layoutByNodeKey,
      [key]: position,
    },
    nodeOrder: type === "AGENT" ? [...draft.nodeOrder, key] : draft.nodeOrder,
  };
}

export function removeWorkflowNode(
  draft: WorkflowBuilderDraft,
  nodeKey: string,
): WorkflowBuilderDraft {
  const removedKeys = new Set([nodeKey]);
  const nodes = draft.definition.nodes
    .filter((node) => node.key !== nodeKey)
    .map((node) => pruneBranchReferences(node, removedKeys));
  const edges = draft.definition.edges.filter(
    (edge) => edge.from !== nodeKey && edge.to !== nodeKey,
  );
  const layoutByNodeKey = { ...draft.layoutByNodeKey };
  delete layoutByNodeKey[nodeKey];
  return {
    ...draft,
    definition: { ...draft.definition, nodes, edges },
    layoutByNodeKey,
    nodeOrder: draft.nodeOrder.filter((key) => key !== nodeKey),
  };
}

export function connectWorkflowNodes(
  draft: WorkflowBuilderDraft,
  from: string,
  to: string,
): WorkflowBuilderDraft {
  if (from === to) {
    return draft;
  }
  if (hasEdge(draft.definition.edges, from, to)) {
    return draft;
  }
  const nodeKeys = new Set(draft.definition.nodes.map((node) => node.key));
  if (!nodeKeys.has(from) || !nodeKeys.has(to)) {
    return draft;
  }
  return {
    ...draft,
    definition: {
      ...draft.definition,
      edges: [...draft.definition.edges, { from, to }],
    },
  };
}

export function disconnectWorkflowEdge(
  draft: WorkflowBuilderDraft,
  from: string,
  to: string,
): WorkflowBuilderDraft {
  const edges = draft.definition.edges.filter(
    (edge) => !(edge.from === from && edge.to === to),
  );
  const nodes = draft.definition.nodes.map((node) => {
    if (node.type !== "BRANCH" || node.key !== from) {
      return node;
    }
    const cases = node.cases.filter((branchCase) => branchCase.to !== to);
    const defaultTo = node.defaultTo === to ? "" : node.defaultTo;
    return { ...node, cases, defaultTo };
  });
  return {
    ...draft,
    definition: { ...draft.definition, nodes, edges },
  };
}

export function setNodeLayout(
  draft: WorkflowBuilderDraft,
  nodeKey: string,
  layout: WorkflowNodeLayout,
): WorkflowBuilderDraft {
  if (!draft.definition.nodes.some((node) => node.key === nodeKey)) {
    return draft;
  }
  return {
    ...draft,
    layoutByNodeKey: {
      ...draft.layoutByNodeKey,
      [nodeKey]: layout,
    },
  };
}

export function updateWorkflowNode(
  draft: WorkflowBuilderDraft,
  nodeKey: string,
  nextNode: WorkflowDefinitionNodeV3,
): WorkflowBuilderDraft {
  if (nextNode.key !== nodeKey) {
    return draft;
  }
  const nodes = draft.definition.nodes.map((node) =>
    node.key === nodeKey ? nextNode : node,
  );
  return {
    ...draft,
    definition: { ...draft.definition, nodes },
  };
}

export function setAgentNodeVersion(
  draft: WorkflowBuilderDraft,
  nodeKey: string,
  agentVersionId: AgentVersionId,
): WorkflowBuilderDraft {
  const nodes = draft.definition.nodes.map((node) => {
    if (node.type !== "AGENT" || node.key !== nodeKey) {
      return node;
    }
    return { ...node, agentVersionId };
  });
  return {
    ...draft,
    definition: { ...draft.definition, nodes },
  };
}

export function listAgentNodesInDraft(
  draft: WorkflowBuilderDraft,
): WorkflowDefinitionAgentNodeV2[] {
  return draft.definition.nodes.filter(
    (node): node is WorkflowDefinitionAgentNodeV2 => node.type === "AGENT",
  );
}

export function outgoingTargets(
  draft: WorkflowBuilderDraft,
  nodeKey: string,
): readonly string[] {
  return draft.definition.edges
    .filter((edge) => edge.from === nodeKey)
    .map((edge) => edge.to)
    .sort((left, right) => left.localeCompare(right));
}

export function duplicateEdgeKeys(
  edges: readonly WorkflowDefinitionV3["edges"][number][],
): boolean {
  const seen = new Set<string>();
  for (const edge of edges) {
    const identity = edgeIdentity(edge.from, edge.to);
    if (seen.has(identity)) {
      return true;
    }
    seen.add(identity);
  }
  return false;
}
