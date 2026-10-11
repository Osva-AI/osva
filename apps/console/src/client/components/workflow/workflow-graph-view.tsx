import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useMemo } from "react";

import {
  WORKFLOW_GRAPH_NODE_TYPE,
  definitionToFlow,
  type WorkflowGraphNodeData,
} from "../../lib/workflow-definition-graph-adapter";
import type { WorkflowDefinitionView } from "../../lib/workflow-definition";

import "@xyflow/react/dist/style.css";

const nodeTypes: NodeTypes = {
  [WORKFLOW_GRAPH_NODE_TYPE]: WorkflowGraphNode,
};

export interface WorkflowGraphViewProps {
  readonly definition: WorkflowDefinitionView;
}

export function WorkflowGraphView({ definition }: WorkflowGraphViewProps) {
  const { nodes, edges } = useMemo(
    () => definitionToFlow(definition),
    [definition],
  );

  return (
    <div
      className="workflow-graph-view"
      data-testid="workflow-graph-view"
      aria-label="Workflow definition graph (read-only)"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable
        edgesFocusable
        elementsSelectable={false}
        connectOnClick={false}
        deleteKeyCode={null}
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

type WorkflowGraphFlowNode = Node<
  WorkflowGraphNodeData,
  typeof WORKFLOW_GRAPH_NODE_TYPE
>;

function WorkflowGraphNode({ data }: NodeProps<WorkflowGraphFlowNode>) {
  const nodeTypeClass = data.nodeType.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return (
    <div
      className={`workflow-graph-node workflow-graph-node--${nodeTypeClass}`}
      aria-label={`${data.nodeType} node ${data.nodeKey}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        aria-hidden
      />
      <div className="workflow-graph-node__type">{data.nodeType}</div>
      <div className="workflow-graph-node__key mono">{data.nodeKey}</div>
      <div className="workflow-graph-node__label mono">{data.label}</div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        aria-hidden
      />
    </div>
  );
}
