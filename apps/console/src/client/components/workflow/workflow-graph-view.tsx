import { Background, BackgroundVariant, ReactFlow } from "@xyflow/react";
import { useMemo } from "react";

import { definitionToFlow } from "../../lib/workflow-definition-graph-adapter";
import type { WorkflowDefinitionView } from "../../lib/workflow-definition";
import { workflowGraphNodeTypes } from "./workflow-graph-node";

import "@xyflow/react/dist/style.css";

export interface WorkflowGraphViewProps {
  readonly definition: WorkflowDefinitionView;
  readonly errorNodeKeys?: ReadonlySet<string>;
  readonly executionStatusByNodeKey?: Readonly<Record<string, string>>;
  readonly edgeAppearanceById?: Readonly<Record<string, string>>;
  readonly selectedNodeKey?: string;
  readonly onNodeSelect?: (nodeKey: string | undefined) => void;
}

export function WorkflowGraphView({
  definition,
  errorNodeKeys,
  executionStatusByNodeKey,
  edgeAppearanceById,
  selectedNodeKey,
  onNodeSelect,
}: WorkflowGraphViewProps) {
  const inspectable = onNodeSelect !== undefined;
  const { nodes, edges } = useMemo(
    () =>
      definitionToFlow(definition, {
        interaction: "readonly",
        errorNodeKeys,
        executionStatusByNodeKey,
        edgeAppearanceById,
      }),
    [definition, edgeAppearanceById, errorNodeKeys, executionStatusByNodeKey],
  );

  const nodesWithSelection = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeKey,
      })),
    [nodes, selectedNodeKey],
  );

  return (
    <div
      className="workflow-graph-view"
      data-testid="workflow-graph-view"
      aria-label="Workflow definition graph (read-only)"
    >
      <ReactFlow
        nodes={nodesWithSelection}
        edges={edges}
        nodeTypes={workflowGraphNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable
        edgesFocusable
        elementsSelectable={inspectable}
        connectOnClick={false}
        deleteKeyCode={null}
        onNodeClick={
          inspectable ? (_event, node) => onNodeSelect(node.id) : undefined
        }
        onPaneClick={inspectable ? () => onNodeSelect(undefined) : undefined}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        preventScrolling={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="var(--border)"
        />
      </ReactFlow>
    </div>
  );
}
