import type {
  AgentVersionId,
  WorkflowDefinitionAgentNodeV2,
  WorkflowDefinitionV3,
} from "@osva-ai/contracts";
import { workflowDefinitionSchema } from "@osva-ai/contracts/schemas";

export interface WorkflowNodeLayout {
  readonly x: number;
  readonly y: number;
}

export interface WorkflowBuilderRegistry {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface WorkflowBuilderDraft {
  readonly draftId: string;
  readonly workspaceId: string;
  readonly registry: WorkflowBuilderRegistry;
  /** Canonical executable graph (V3, AGENT-only nodes in M8.3.1). */
  readonly definition: WorkflowDefinitionV3;
  /** UI / future canvas positions — never persisted in workflow definition. */
  readonly layoutByNodeKey: Readonly<Record<string, WorkflowNodeLayout>>;
  /** Linear chain order; keys remain stable when reordered. */
  readonly nodeOrder: readonly string[];
  readonly nextNodeSequence: number;
  /** Set after registry create succeeds; used to retry version publish. */
  readonly createdWorkflowId?: string;
}

const LAYOUT_X = 80;
const LAYOUT_Y_START = 40;
const LAYOUT_Y_STEP = 120;

export function createDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draft-${String(Date.now())}`;
}

export function createEmptyWorkflowBuilderDraft(
  workspaceId: string,
): WorkflowBuilderDraft {
  return {
    draftId: createDraftId(),
    workspaceId,
    registry: { key: "", name: "" },
    definition: { schemaVersion: "3", nodes: [], edges: [] },
    layoutByNodeKey: {},
    nodeOrder: [],
    nextNodeSequence: 1,
  };
}

export function updateRegistry(
  draft: WorkflowBuilderDraft,
  registry: WorkflowBuilderRegistry,
): WorkflowBuilderDraft {
  return { ...draft, registry };
}

export function setCreatedWorkflowId(
  draft: WorkflowBuilderDraft,
  createdWorkflowId: string,
): WorkflowBuilderDraft {
  return { ...draft, createdWorkflowId };
}

function stableNodeKey(sequence: number): string {
  return `agent-step-${sequence}`;
}

function rebuildLinearEdges(
  nodeOrder: readonly string[],
): WorkflowDefinitionV3["edges"] {
  const edges: Array<{ from: string; to: string }> = [];
  for (let index = 0; index < nodeOrder.length - 1; index += 1) {
    edges.push({ from: nodeOrder[index]!, to: nodeOrder[index + 1]! });
  }
  return edges;
}

function syncLayout(
  nodeOrder: readonly string[],
  layoutByNodeKey: Readonly<Record<string, WorkflowNodeLayout>>,
): Readonly<Record<string, WorkflowNodeLayout>> {
  const next: Record<string, WorkflowNodeLayout> = { ...layoutByNodeKey };
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

export function addAgentNode(
  draft: WorkflowBuilderDraft,
  agentVersionId: AgentVersionId = "" as AgentVersionId,
): WorkflowBuilderDraft {
  const sequence = draft.nextNodeSequence;
  const key = stableNodeKey(sequence);
  const node: WorkflowDefinitionAgentNodeV2 = {
    key,
    type: "AGENT",
    agentVersionId,
  };
  const nodeOrder = [...draft.nodeOrder, key];
  const byKey = nodesByKey(
    draft.definition.nodes.filter(
      isAgentNode,
    ) as WorkflowDefinitionAgentNodeV2[],
  );
  byKey.set(key, node);
  const nodes = nodeOrder
    .map((nodeKey) => byKey.get(nodeKey))
    .filter((n): n is WorkflowDefinitionAgentNodeV2 => n !== undefined);
  const definition: WorkflowDefinitionV3 = {
    schemaVersion: "3",
    nodes,
    edges: rebuildLinearEdges(nodeOrder),
  };
  return {
    ...draft,
    nextNodeSequence: sequence + 1,
    nodeOrder,
    definition,
    layoutByNodeKey: syncLayout(nodeOrder, draft.layoutByNodeKey),
  };
}

export function removeAgentNode(
  draft: WorkflowBuilderDraft,
  nodeKey: string,
): WorkflowBuilderDraft {
  const nodeOrder = draft.nodeOrder.filter((key) => key !== nodeKey);
  const agentNodes = draft.definition.nodes
    .filter(isAgentNode)
    .filter((node) => node.key !== nodeKey);
  const definition: WorkflowDefinitionV3 = {
    schemaVersion: "3",
    nodes: agentNodes,
    edges: rebuildLinearEdges(nodeOrder),
  };
  return {
    ...draft,
    nodeOrder,
    definition,
    layoutByNodeKey: syncLayout(nodeOrder, draft.layoutByNodeKey),
  };
}

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
      isAgentNode,
    ) as WorkflowDefinitionAgentNodeV2[],
  );
  const nodes = nodeOrder
    .map((key) => byKey.get(key))
    .filter(
      (node): node is WorkflowDefinitionAgentNodeV2 => node !== undefined,
    );
  const definition: WorkflowDefinitionV3 = {
    schemaVersion: "3",
    nodes,
    edges: rebuildLinearEdges(nodeOrder),
  };
  return {
    ...draft,
    nodeOrder,
    definition,
    layoutByNodeKey: syncLayout(nodeOrder, draft.layoutByNodeKey),
  };
}

export function setAgentNodeVersion(
  draft: WorkflowBuilderDraft,
  nodeKey: string,
  agentVersionId: AgentVersionId,
): WorkflowBuilderDraft {
  const nodes = draft.definition.nodes.map((node) => {
    if (!isAgentNode(node) || node.key !== nodeKey) {
      return node;
    }
    return { ...node, agentVersionId };
  });
  return {
    ...draft,
    definition: {
      ...draft.definition,
      nodes,
    },
  };
}

export function definitionForPublish(
  draft: WorkflowBuilderDraft,
): WorkflowDefinitionV3 {
  return {
    schemaVersion: "3",
    nodes: draft.definition.nodes,
    edges: draft.definition.edges,
  };
}

export function assertNoLayoutInDefinition(
  definition: WorkflowDefinitionV3,
): void {
  const serialized = JSON.stringify(definition);
  if (serialized.includes("layoutByNodeKey")) {
    throw new Error("Layout must not appear in persisted workflow definition.");
  }
}

export interface ClientDefinitionValidation {
  readonly ok: true;
  readonly definition: WorkflowDefinitionV3;
}

export interface ClientDefinitionValidationError {
  readonly ok: false;
  readonly message: string;
}

export function validateRegistryFields(
  registry: WorkflowBuilderRegistry,
): string | undefined {
  if (registry.key.trim().length === 0) {
    return "Workflow key is required.";
  }
  if (registry.name.trim().length === 0) {
    return "Workflow name is required.";
  }
  return undefined;
}

export function validateDraftForPublish(
  draft: WorkflowBuilderDraft,
): ClientDefinitionValidation | ClientDefinitionValidationError {
  const registryError = validateRegistryFields(draft.registry);
  if (registryError !== undefined) {
    return { ok: false, message: registryError };
  }
  if (draft.nodeOrder.length === 0) {
    return { ok: false, message: "Add at least one AGENT step." };
  }
  for (const key of draft.nodeOrder) {
    const node = draft.definition.nodes.find(
      (candidate) => isAgentNode(candidate) && candidate.key === key,
    );
    if (
      node === undefined ||
      !isAgentNode(node) ||
      node.agentVersionId.trim().length === 0
    ) {
      return {
        ok: false,
        message: `Select an agent version for step ${key}.`,
      };
    }
  }
  const definition = definitionForPublish(draft);
  assertNoLayoutInDefinition(definition);
  const parsed = workflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Workflow definition shape is invalid. Check all agent steps.",
    };
  }
  if (parsed.data.schemaVersion !== "3") {
    return {
      ok: false,
      message: "Workflow builder requires schema version 3.",
    };
  }
  return { ok: true, definition: parsed.data as WorkflowDefinitionV3 };
}

function isAgentNode(
  node: WorkflowDefinitionV3["nodes"][number],
): node is WorkflowDefinitionAgentNodeV2 {
  return node.type === "AGENT";
}

export function listAgentNodesInOrder(
  draft: WorkflowBuilderDraft,
): WorkflowDefinitionAgentNodeV2[] {
  const byKey = nodesByKey(
    draft.definition.nodes.filter(
      isAgentNode,
    ) as WorkflowDefinitionAgentNodeV2[],
  );
  return draft.nodeOrder
    .map((key) => byKey.get(key))
    .filter(
      (node): node is WorkflowDefinitionAgentNodeV2 => node !== undefined,
    );
}
