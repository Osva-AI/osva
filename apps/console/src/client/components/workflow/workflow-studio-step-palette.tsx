import { WORKFLOW_V3_NODE_TYPES } from "@osva-ai/contracts";
import type { WorkflowV3NodeType } from "@osva-ai/contracts";

import { workflowNodePresentation } from "../../lib/workflow-node-catalog";

const STUDIO_PALETTE_LABEL: Record<WorkflowV3NodeType, string> = {
  AGENT: "AI agent",
  BRANCH: "Decision",
  APPROVAL: "Approval",
  WAIT: "Wait",
  PARALLEL: "Parallel paths",
  JOIN: "Merge paths",
};

export function workflowStudioPaletteLabel(type: WorkflowV3NodeType): string {
  return STUDIO_PALETTE_LABEL[type];
}

export function WorkflowStudioStepPalette({
  disabled,
  onAddNode,
  compact,
}: {
  readonly disabled: boolean;
  readonly onAddNode: (type: WorkflowV3NodeType) => void;
  readonly compact?: boolean;
}) {
  return (
    <nav
      className={`workflow-studio-palette${compact ? " workflow-studio-palette--compact" : ""}`}
      aria-label="Add workflow step"
    >
      <p className="workflow-studio-palette-title">Steps</p>
      <ul className="workflow-studio-palette-list">
        {WORKFLOW_V3_NODE_TYPES.map((type) => {
          const presentation = workflowNodePresentation(type);
          const label = STUDIO_PALETTE_LABEL[type];
          return (
            <li key={type}>
              <button
                type="button"
                className="workflow-studio-palette-item"
                disabled={disabled}
                data-node-type={type}
                onClick={() => onAddNode(type)}
              >
                <span className="workflow-studio-palette-item-label">
                  {label}
                </span>
                <span className="workflow-studio-palette-item-help">
                  {presentation.shortDescription}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
