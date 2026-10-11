import { Background, BackgroundVariant, ReactFlow } from "@xyflow/react";
import { useMemo } from "react";

import { definitionToFlow } from "../../lib/workflow-definition-graph-adapter";
import type { WorkflowDefinitionView } from "../../lib/workflow-definition";
import { workflowGraphNodeTypes } from "./workflow-graph-node";

import "@xyflow/react/dist/style.css";

export interface WorkflowGraphViewProps {
  readonly definition: WorkflowDefinitionView;
}

export function WorkflowGraphView({ definition }: WorkflowGraphViewProps) {
  const { nodes, edges } = useMemo(
    () => definitionToFlow(definition, { interaction: "readonly" }),
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
        nodeTypes={workflowGraphNodeTypes}
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
