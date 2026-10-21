import type { WorkflowV3NodeType } from "@osva-ai/contracts";

export interface WorkflowNodeTypePresentation {
  readonly type: WorkflowV3NodeType;
  readonly label: string;
  readonly shortDescription: string;
  readonly paletteLabel: string;
}

export const WORKFLOW_NODE_PRESENTATIONS: Record<
  WorkflowV3NodeType,
  WorkflowNodeTypePresentation
> = {
  AGENT: {
    type: "AGENT",
    label: "Run AI agent",
    shortDescription:
      "Runs a published agent version and passes output to the next step.",
    paletteLabel: "Run AI agent",
  },
  BRANCH: {
    type: "BRANCH",
    label: "Make a decision",
    shortDescription:
      "Chooses one outgoing path based on a field in the previous step's output.",
    paletteLabel: "Make a decision",
  },
  PARALLEL: {
    type: "PARALLEL",
    label: "Run steps together",
    shortDescription:
      "Starts multiple paths at once. Connect one incoming edge and two or more outgoing edges.",
    paletteLabel: "Run steps together",
  },
  JOIN: {
    type: "JOIN",
    label: "Merge parallel paths",
    shortDescription:
      "Waits for parallel paths to finish, then continues with combined outputs.",
    paletteLabel: "Merge parallel paths",
  },
  APPROVAL: {
    type: "APPROVAL",
    label: "Request approval",
    shortDescription:
      "Pauses until a person approves or rejects in the Console.",
    paletteLabel: "Request approval",
  },
  WAIT: {
    type: "WAIT",
    label: "Wait for time or event",
    shortDescription:
      "Pauses for a timer, until a date, or until an external event arrives.",
    paletteLabel: "Wait for time or event",
  },
};

export function workflowNodePresentation(
  type: WorkflowV3NodeType,
): WorkflowNodeTypePresentation {
  return WORKFLOW_NODE_PRESENTATIONS[type];
}

export function workflowNodePaletteLabel(type: WorkflowV3NodeType): string {
  return WORKFLOW_NODE_PRESENTATIONS[type].paletteLabel;
}
