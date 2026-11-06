import type { Node } from "@xyflow/react";

import type { WorkflowDefinitionView } from "./workflow-definition";
import {
  definitionToFlow,
  WORKFLOW_GRAPH_NODE_TYPE,
  type WorkflowGraphNodeData,
  type WorkflowDefinitionFlowModel,
} from "./workflow-definition-graph-adapter";

function agentHeadline(spec: Record<string, unknown>): {
  readonly headline: string;
  readonly badge: "NEW" | "EXISTING";
} {
  if (spec.kind === "EXISTING") {
    const id =
      typeof spec.agentVersionId === "string" ? spec.agentVersionId : "";
    const short = id.length > 12 ? `${id.slice(0, 8)}…` : id;
    return {
      headline: `Existing catalog${short ? ` (${short})` : ""}`,
      badge: "EXISTING",
    };
  }
  const name =
    typeof spec.agentName === "string" && spec.agentName.trim().length > 0
      ? spec.agentName.trim()
      : "New agent";
  return { headline: name, badge: "NEW" };
}

/**
 * Visual-only: BuilderProposalV1.workflow → React Flow. No AgentVersion IDs; draft-only labels.
 */
export function builderProposalWorkflowToFlowModel(input: {
  readonly workflow: {
    readonly nodes: readonly Record<string, unknown>[];
    readonly edges: readonly { readonly from: string; readonly to: string }[];
  };
  readonly agents: readonly Record<string, unknown>[];
}): WorkflowDefinitionFlowModel {
  const byRef = new Map<
    string,
    { readonly headline: string; readonly badge: "NEW" | "EXISTING" }
  >();
  for (const spec of input.agents) {
    const ref = typeof spec.ref === "string" ? spec.ref : "";
    if (ref.length === 0) {
      continue;
    }
    byRef.set(ref, agentHeadline(spec));
  }

  const nodesForView = input.workflow.nodes.map((raw) => {
    const key = typeof raw.key === "string" ? raw.key : "node";
    const type = typeof raw.type === "string" ? raw.type : "UNKNOWN";
    return { ...raw, key, type };
  });

  const definition: WorkflowDefinitionView = {
    schemaVersion: "3",
    nodes: nodesForView,
    edges: input.workflow.edges,
  };

  const { nodes, edges } = definitionToFlow(definition, {
    interaction: "readonly",
    showTechnicalKey: true,
  });

  const nodeByKey = new Map(
    input.workflow.nodes.map((n) => [String(n.key ?? ""), n]),
  );

  const enriched: Node<WorkflowGraphNodeData>[] = nodes.map((node) => {
    if (node.data.nodeType !== "AGENT") {
      return node;
    }
    const raw = nodeByKey.get(node.data.nodeKey);
    const ref =
      raw !== undefined && typeof raw.agentRef === "string" ? raw.agentRef : "";
    const summary = byRef.get(ref);
    const headline = (summary?.headline ?? ref) || "Agent";
    const badge = summary?.badge ?? "NEW";
    return {
      ...node,
      data: {
        ...node.data,
        label: `${headline} (${badge})`,
      },
    };
  });

  return { nodes: enriched, edges };
}

export { WORKFLOW_GRAPH_NODE_TYPE };
