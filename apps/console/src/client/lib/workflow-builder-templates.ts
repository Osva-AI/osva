import type { AgentVersionId, WorkflowDefinitionV3 } from "@osva-ai/contracts";

import type { WorkflowBuilderDraft } from "./workflow-builder-draft";
import { computeAutoLayoutByNodeKey } from "./workflow-definition-graph-adapter";
import { asWorkflowDefinitionView } from "./workflow-definition";

export type WorkflowBuilderTemplateId =
  "sequential-agents" | "agent-with-approval";

export interface WorkflowBuilderTemplate {
  readonly id: WorkflowBuilderTemplateId;
  readonly name: string;
  readonly description: string;
  readonly definition: WorkflowDefinitionV3;
}

const SEQUENTIAL_AGENTS: WorkflowDefinitionV3 = {
  schemaVersion: "3",
  nodes: [
    {
      key: "agent-step-1",
      type: "AGENT",
      agentVersionId: "" as AgentVersionId,
    },
    {
      key: "agent-step-2",
      type: "AGENT",
      agentVersionId: "" as AgentVersionId,
    },
  ],
  edges: [{ from: "agent-step-1", to: "agent-step-2" }],
};

const AGENT_WITH_APPROVAL: WorkflowDefinitionV3 = {
  schemaVersion: "3",
  nodes: [
    {
      key: "agent-step-1",
      type: "AGENT",
      agentVersionId: "" as AgentVersionId,
    },
    {
      key: "approval-2",
      type: "APPROVAL",
      title: "Review before continuing",
      description:
        "Confirm the previous agent output before the next step runs.",
    },
    {
      key: "agent-step-3",
      type: "AGENT",
      agentVersionId: "" as AgentVersionId,
    },
  ],
  edges: [
    { from: "agent-step-1", to: "approval-2" },
    { from: "approval-2", to: "agent-step-3" },
  ],
};

export const WORKFLOW_BUILDER_TEMPLATES: readonly WorkflowBuilderTemplate[] = [
  {
    id: "sequential-agents",
    name: "Sequential agent processing",
    description:
      "Two agent steps in a row. Bind a published agent version on each step before publishing.",
    definition: SEQUENTIAL_AGENTS,
  },
  {
    id: "agent-with-approval",
    name: "Agent with human approval",
    description:
      "An agent step, an approval gate, then another agent step. Configure agents and approval text before publishing.",
    definition: AGENT_WITH_APPROVAL,
  },
];

export function applyWorkflowBuilderTemplate(
  draft: WorkflowBuilderDraft,
  templateId: WorkflowBuilderTemplateId,
): WorkflowBuilderDraft {
  const template = WORKFLOW_BUILDER_TEMPLATES.find(
    (entry) => entry.id === templateId,
  );
  if (template === undefined) {
    return draft;
  }
  const definition: WorkflowDefinitionV3 = {
    schemaVersion: "3",
    nodes: template.definition.nodes.map((node) => ({ ...node })),
    edges: template.definition.edges.map((edge) => ({ ...edge })),
  };
  const layoutByNodeKey = computeAutoLayoutByNodeKey(
    asWorkflowDefinitionView(definition),
  );
  const nodeOrder = definition.nodes.map((node) => node.key);
  return {
    ...draft,
    draftId: draft.draftId,
    definition,
    layoutByNodeKey,
    nodeOrder,
    nextNodeSequence: computeNextNodeSequenceFromKeys(nodeOrder) + 1,
  };
}

function computeNextNodeSequenceFromKeys(keys: readonly string[]): number {
  let max = 0;
  for (const key of keys) {
    const match = /-(\d+)$/.exec(key);
    if (match !== null) {
      max = Math.max(max, Number.parseInt(match[1]!, 10));
    }
  }
  return max;
}
