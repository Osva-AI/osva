import type { Edge, Node } from "@xyflow/react";

import {
  orderWorkflowNodeKeys,
  type WorkflowDefinitionView,
} from "./workflow-definition";

export interface WorkflowNodeLayout {
  readonly x: number;
  readonly y: number;
}

export type WorkflowGraphInteraction = "readonly" | "editable";

export interface DefinitionToFlowOptions {
  readonly layoutByNodeKey?: Readonly<Record<string, WorkflowNodeLayout>>;
  readonly interaction?: WorkflowGraphInteraction;
  readonly errorNodeKeys?: ReadonlySet<string>;
  readonly executionStatusByNodeKey?: Readonly<Record<string, string>>;
}

export interface WorkflowGraphNodeData extends Record<string, unknown> {
  readonly nodeKey: string;
  readonly nodeType: string;
  readonly label: string;
  readonly hasError?: boolean;
  readonly executionStatus?: string;
}

export const WORKFLOW_GRAPH_NODE_TYPE = "workflowDefinition" as const;

export interface WorkflowDefinitionFlowModel {
  readonly nodes: Node<WorkflowGraphNodeData>[];
  readonly edges: Edge[];
}

const LAYER_WIDTH = 220;
const ROW_HEIGHT = 96;
const ORIGIN_X = 48;
const ORIGIN_Y = 40;

/**
 * Layered DAG layout: longest-path depth from predecessors, stable row order by node key.
 */
export function computeAutoLayoutByNodeKey(
  definition: WorkflowDefinitionView,
): Readonly<Record<string, WorkflowNodeLayout>> {
  const nodeKeys = new Set(definition.nodes.map((node) => node.key));
  const incoming = new Map<string, readonly string[]>();

  for (const key of nodeKeys) {
    incoming.set(key, []);
  }

  for (const edge of definition.edges) {
    if (!nodeKeys.has(edge.from) || !nodeKeys.has(edge.to)) {
      continue;
    }
    const sources = incoming.get(edge.to);
    if (sources !== undefined) {
      incoming.set(edge.to, [...sources, edge.from]);
    }
  }

  const layerByKey = new Map<string, number>();
  for (const key of orderWorkflowNodeKeys(definition)) {
    const predecessors = incoming.get(key) ?? [];
    const layer =
      predecessors.length === 0
        ? 0
        : Math.max(
            ...predecessors.map(
              (predecessor) => (layerByKey.get(predecessor) ?? 0) + 1,
            ),
          );
    layerByKey.set(key, layer);
  }

  for (const key of nodeKeys) {
    if (!layerByKey.has(key)) {
      layerByKey.set(key, 0);
    }
  }

  const keysByLayer = new Map<number, string[]>();
  for (const [key, layer] of layerByKey) {
    const bucket = keysByLayer.get(layer);
    if (bucket === undefined) {
      keysByLayer.set(layer, [key]);
    } else {
      bucket.push(key);
    }
  }

  for (const bucket of keysByLayer.values()) {
    bucket.sort((left, right) => left.localeCompare(right));
  }

  const layout: Record<string, WorkflowNodeLayout> = {};
  for (const [layer, keys] of keysByLayer) {
    keys.forEach((key, rowIndex) => {
      layout[key] = {
        x: ORIGIN_X + layer * LAYER_WIDTH,
        y: ORIGIN_Y + rowIndex * ROW_HEIGHT,
      };
    });
  }

  return layout;
}

function workflowGraphNodeLabel(
  node: WorkflowDefinitionView["nodes"][number],
): string {
  if (node.type === "AGENT" && typeof node.agentVersionId === "string") {
    return node.agentVersionId;
  }
  if (node.type === "APPROVAL" && typeof node.title === "string") {
    return node.title;
  }
  if (node.type === "BRANCH" && typeof node.selector === "string") {
    return node.selector;
  }
  if (node.type === "WAIT" && node.wait !== undefined) {
    return JSON.stringify(node.wait);
  }
  return node.key;
}

function resolveLayout(
  definition: WorkflowDefinitionView,
  layoutByNodeKey: Readonly<Record<string, WorkflowNodeLayout>> | undefined,
): Readonly<Record<string, WorkflowNodeLayout>> {
  const auto = computeAutoLayoutByNodeKey(definition);
  if (layoutByNodeKey === undefined) {
    return auto;
  }
  const merged: Record<string, WorkflowNodeLayout> = { ...auto };
  for (const node of definition.nodes) {
    const saved = layoutByNodeKey[node.key];
    if (saved !== undefined) {
      merged[node.key] = saved;
    }
  }
  return merged;
}

/**
 * Maps a persisted workflow definition into React Flow view models. Does not mutate `definition`.
 */
export function definitionToFlow(
  definition: WorkflowDefinitionView,
  options: DefinitionToFlowOptions = {},
): WorkflowDefinitionFlowModel {
  const layout = resolveLayout(definition, options.layoutByNodeKey);
  const editable = options.interaction === "editable";

  const nodes: Node<WorkflowGraphNodeData>[] = definition.nodes.map((node) => {
    const position = layout[node.key] ?? { x: ORIGIN_X, y: ORIGIN_Y };
    return {
      id: node.key,
      type: WORKFLOW_GRAPH_NODE_TYPE,
      position: { x: position.x, y: position.y },
      data: {
        nodeKey: node.key,
        nodeType: node.type,
        label: workflowGraphNodeLabel(node),
        hasError: options.errorNodeKeys?.has(node.key) === true,
        ...(options.executionStatusByNodeKey?.[node.key] !== undefined
          ? { executionStatus: options.executionStatusByNodeKey[node.key] }
          : {}),
      },
      draggable: editable,
      selectable: true,
      connectable: editable,
      focusable: true,
    };
  });

  const edges: Edge[] = [...definition.edges]
    .sort((left, right) => {
      const fromCompare = left.from.localeCompare(right.from);
      if (fromCompare !== 0) {
        return fromCompare;
      }
      return left.to.localeCompare(right.to);
    })
    .map((edge) => ({
      id: `edge:${edge.from}->${edge.to}`,
      source: edge.from,
      target: edge.to,
      selectable: editable,
      focusable: true,
      deletable: editable,
    }));

  return { nodes, edges };
}
