import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useCallback, useMemo } from "react";

import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-draft";
import {
  connectWorkflowNodes,
  disconnectWorkflowEdge,
  setNodeLayout,
} from "../../lib/workflow-builder-graph";
import {
  definitionToFlow,
  type WorkflowGraphNodeData,
} from "../../lib/workflow-definition-graph-adapter";
import { asWorkflowDefinitionView } from "../../lib/workflow-definition";
import { workflowGraphNodeTypes } from "./workflow-graph-node";

import "@xyflow/react/dist/style.css";

export interface WorkflowBuilderCanvasProps {
  readonly draft: WorkflowBuilderDraft;
  readonly onDraftChange: (draft: WorkflowBuilderDraft) => void;
  readonly disabled: boolean;
  readonly selectedNodeKey: string | undefined;
  readonly onSelectNodeKey: (nodeKey: string | undefined) => void;
}

export function WorkflowBuilderCanvas(props: WorkflowBuilderCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowBuilderCanvasInner({
  draft,
  onDraftChange,
  disabled,
  selectedNodeKey,
  onSelectNodeKey,
}: WorkflowBuilderCanvasProps) {
  const { nodes, edges } = useMemo(
    () =>
      definitionToFlow(asWorkflowDefinitionView(draft.definition), {
        layoutByNodeKey: draft.layoutByNodeKey,
        interaction: disabled ? "readonly" : "editable",
      }),
    [draft, disabled],
  );

  const nodesWithSelection = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeKey,
      })),
    [nodes, selectedNodeKey],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (
        disabled ||
        connection.source === null ||
        connection.target === null
      ) {
        return;
      }
      onDraftChange(
        connectWorkflowNodes(draft, connection.source, connection.target),
      );
    },
    [disabled, draft, onDraftChange],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node<WorkflowGraphNodeData>) => {
      if (disabled) {
        return;
      }
      onDraftChange(
        setNodeLayout(draft, node.id, {
          x: node.position.x,
          y: node.position.y,
        }),
      );
    },
    [disabled, draft, onDraftChange],
  );

  const onEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      if (disabled) {
        return;
      }
      let next = draft;
      for (const edge of deletedEdges) {
        next = disconnectWorkflowEdge(next, edge.source, edge.target);
      }
      onDraftChange(next);
    },
    [disabled, draft, onDraftChange],
  );

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (disabled) {
        return false;
      }
      return (
        connection.source !== connection.target &&
        connection.source !== null &&
        connection.target !== null
      );
    },
    [disabled],
  );

  return (
    <div
      className="workflow-graph-view workflow-graph-view--editable"
      data-testid="workflow-builder-canvas"
    >
      <ReactFlow
        nodes={nodesWithSelection}
        edges={edges}
        nodeTypes={workflowGraphNodeTypes}
        nodesDraggable={!disabled}
        nodesConnectable={!disabled}
        nodesFocusable
        edgesFocusable
        elementsSelectable={!disabled}
        connectOnClick={false}
        deleteKeyCode={disabled ? null : "Delete"}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onEdgesDelete={onEdgesDelete}
        isValidConnection={isValidConnection}
        onNodeClick={(_event, node) => onSelectNodeKey(node.id)}
        onPaneClick={() => onSelectNodeKey(undefined)}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
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
