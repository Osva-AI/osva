import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import {
  WORKFLOW_GRAPH_NODE_TYPE,
  type WorkflowGraphNodeData,
} from "../../lib/workflow-definition-graph-adapter";
import { workflowNodePresentation } from "../../lib/workflow-node-catalog";
import { describeWorkflowNodeExecutionStatus } from "../../lib/workflow-execution-labels";
import type { WorkflowV3NodeType } from "@osva-ai/contracts";

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
      ? ` (${describeWorkflowNodeExecutionStatus(data.executionStatus)})`
      : "";
  const typePresentation = isWorkflowV3NodeType(data.nodeType)
    ? workflowNodePresentation(data.nodeType).label
    : data.nodeType;
  return (
    <div
      className={`workflow-graph-node workflow-graph-node--${nodeTypeClass}${selected ? " workflow-graph-node--selected" : ""}${errorClass}${executionClass}`}
      aria-label={`${typePresentation} step ${data.nodeKey}${data.hasError === true ? " (has errors)" : ""}${executionLabel}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="workflow-graph-node__type">{typePresentation}</div>
      <div className="workflow-graph-node__label">{data.label}</div>
      <div className="workflow-graph-node__key mono">{data.nodeKey}</div>
      {data.executionStatus !== undefined ? (
        <div className="workflow-graph-node__exec">
          {describeWorkflowNodeExecutionStatus(data.executionStatus)}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const workflowGraphNodeTypes = {
  [WORKFLOW_GRAPH_NODE_TYPE]: WorkflowGraphNode,
};

function isWorkflowV3NodeType(value: string): value is WorkflowV3NodeType {
  return (
    value === "AGENT" ||
    value === "BRANCH" ||
    value === "PARALLEL" ||
    value === "JOIN" ||
    value === "APPROVAL" ||
    value === "WAIT"
  );
}
