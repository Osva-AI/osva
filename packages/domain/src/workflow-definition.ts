import type {
  WorkflowDefinitionEdgeV1,
  WorkflowDefinitionNodeV1,
  WorkflowDefinitionV1,
} from "@osva/contracts";
import { WORKFLOW_EXECUTABLE_NODE_TYPES } from "@osva/contracts";

import { InvalidWorkflowDefinitionError } from "./errors.js";

const EXECUTABLE_NODE_TYPE_SET = new Set<string>(
  WORKFLOW_EXECUTABLE_NODE_TYPES,
);

export function assertSequentialWorkflowDefinition(
  definition: WorkflowDefinitionV1,
): void {
  if (definition.schemaVersion !== "1") {
    throw new InvalidWorkflowDefinitionError(
      `Unsupported workflow definition schemaVersion '${String(definition.schemaVersion)}'.`,
    );
  }

  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must contain at least one node.",
    );
  }

  if (!Array.isArray(definition.edges)) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition edges must be an array.",
    );
  }

  const nodesByKey = new Map<string, WorkflowDefinitionNodeV1>();
  for (const node of definition.nodes) {
    assertAgentNode(node);
    if (nodesByKey.has(node.key)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow node key '${node.key}' is duplicated.`,
      );
    }

    nodesByKey.set(node.key, node);
  }

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const key of nodesByKey.keys()) {
    incoming.set(key, []);
    outgoing.set(key, []);
  }

  for (const edge of definition.edges) {
    assertEdge(edge, nodesByKey);
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }

  for (const [key, sources] of incoming) {
    if (sources.length > 1) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow node '${key}' has multiple incoming edges, which Slice 2.1 sequential execution does not allow.`,
      );
    }
  }

  for (const [key, targets] of outgoing) {
    if (targets.length > 1) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow node '${key}' has multiple outgoing edges, which Slice 2.1 sequential execution does not allow.`,
      );
    }
  }

  const entryNodes = definition.nodes.filter(
    (node) => (incoming.get(node.key) ?? []).length === 0,
  );
  const terminalNodes = definition.nodes.filter(
    (node) => (outgoing.get(node.key) ?? []).length === 0,
  );

  if (entryNodes.length !== 1 || entryNodes[0] === undefined) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must have exactly one entry node.",
    );
  }

  if (terminalNodes.length !== 1) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must have exactly one terminal node.",
    );
  }

  const visited = new Set<string>();
  let current: string | undefined = entryNodes[0].key;
  while (current !== undefined) {
    if (visited.has(current)) {
      throw new InvalidWorkflowDefinitionError(
        "Workflow definition contains a cycle.",
      );
    }

    visited.add(current);
    current = outgoing.get(current)?.[0];
  }

  if (visited.size !== definition.nodes.length) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition contains a node that is not part of the sequential chain from the entry node.",
    );
  }
}

export function orderedSequentialNodeKeys(
  definition: WorkflowDefinitionV1,
): readonly string[] {
  assertSequentialWorkflowDefinition(definition);

  const outgoing = new Map<string, string>();
  for (const edge of definition.edges) {
    outgoing.set(edge.from, edge.to);
  }

  const incoming = new Set(definition.edges.map((edge) => edge.to));
  const entry = definition.nodes.find((node) => !incoming.has(node.key));
  if (entry === undefined) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must have exactly one entry node.",
    );
  }

  const keys: string[] = [];
  let current: string | undefined = entry.key;
  while (current !== undefined) {
    keys.push(current);
    current = outgoing.get(current);
  }

  return keys;
}

function assertAgentNode(node: WorkflowDefinitionNodeV1): void {
  if (typeof node.key !== "string" || node.key.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow node key must be a non-empty string.",
    );
  }

  if (!EXECUTABLE_NODE_TYPE_SET.has(node.type)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow node '${node.key}' has unsupported type '${String(node.type)}'. Slice 2.1 only supports AGENT nodes.`,
    );
  }

  if (
    typeof node.agentVersionId !== "string" ||
    node.agentVersionId.trim().length === 0
  ) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow node '${node.key}' must bind an immutable agentVersionId.`,
    );
  }
}

function assertEdge(
  edge: WorkflowDefinitionEdgeV1,
  nodesByKey: ReadonlyMap<string, WorkflowDefinitionNodeV1>,
): void {
  if (typeof edge.from !== "string" || edge.from.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow edge.from must be a non-empty string.",
    );
  }

  if (typeof edge.to !== "string" || edge.to.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow edge.to must be a non-empty string.",
    );
  }

  if (!nodesByKey.has(edge.from) || !nodesByKey.has(edge.to)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow edge '${edge.from}' → '${edge.to}' references a node that does not exist.`,
    );
  }
}
