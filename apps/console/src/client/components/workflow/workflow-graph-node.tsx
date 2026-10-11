import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import {
  WORKFLOW_GRAPH_NODE_TYPE,
  type WorkflowGraphNodeData,
} from "../../lib/workflow-definition-graph-adapter";

export type WorkflowGraphFlowNode = Node<
  WorkflowGraphNodeData,
  typeof WORKFLOW_GRAPH_NODE_TYPE
>;

export function WorkflowGraphNode({
  data,
  selected,
}: NodeProps<WorkflowGraphFlowNode>) {
  const nodeTypeClass = data.nodeType.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const errorClass =
    data.hasError === true ? " workflow-graph-node--error" : "";
  const executionClass =
    data.executionStatus !== undefined
      ? ` workflow-graph-node--exec-${data.executionStatus.toLowerCase()}`
      : "";
  const executionLabel =
    data.executionStatus !== undefined
      ? ` (execution ${data.executionStatus})`
      : "";
  return (
    <div
      className={`workflow-graph-node workflow-graph-node--${nodeTypeClass}${selected ? " workflow-graph-node--selected" : ""}${errorClass}${executionClass}`}
      aria-label={`${data.nodeType} node ${data.nodeKey}${data.hasError === true ? " (has errors)" : ""}${executionLabel}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="workflow-graph-node__type">{data.nodeType}</div>
      <div className="workflow-graph-node__key mono">{data.nodeKey}</div>
      <div className="workflow-graph-node__label mono">{data.label}</div>
      {data.executionStatus !== undefined ? (
        <div className="workflow-graph-node__exec mono">
          {data.executionStatus}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const workflowGraphNodeTypes = {
  [WORKFLOW_GRAPH_NODE_TYPE]: WorkflowGraphNode,
};
