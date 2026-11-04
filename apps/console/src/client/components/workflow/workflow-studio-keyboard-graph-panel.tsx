import { useState } from "react";

import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-draft";
import {
  tryConnectWorkflowNodes,
  tryDisconnectWorkflowEdge,
} from "../../lib/workflow-builder-graph-connection";
import { resolveWorkflowCanvasLabel } from "../../lib/workflow-canvas-labels";
import type { WorkflowCanvasLabelContext } from "../../lib/workflow-canvas-labels";
import { workflowNodePresentation } from "../../lib/workflow-node-catalog";
import { Button } from "../ui/button";
import { InlineMessage } from "../ui/inline-message";

export function WorkflowStudioKeyboardGraphPanel({
  draft,
  disabled,
  canvasLabelContext,
  onDraftChange,
}: {
  readonly draft: WorkflowBuilderDraft;
  readonly disabled: boolean;
  readonly canvasLabelContext: WorkflowCanvasLabelContext;
  readonly onDraftChange: (draft: WorkflowBuilderDraft) => void;
}) {
  const [sourceKey, setSourceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [feedback, setFeedback] = useState<
    { readonly tone: "info" | "error"; readonly message: string } | undefined
  >();

  function stepLabel(nodeKey: string): string {
    const node = draft.definition.nodes.find(
      (candidate) => candidate.key === nodeKey,
    );
    if (node === undefined) {
      return nodeKey;
    }
    const human = resolveWorkflowCanvasLabel(node, canvasLabelContext);
    const type = workflowNodePresentation(node.type).label;
    return `${human} (${type})`;
  }

  function connect(): void {
    const result = tryConnectWorkflowNodes(draft, sourceKey, targetKey);
    setFeedback({
      tone: result.ok ? "info" : "error",
      message: result.message,
    });
    if (result.ok) {
      onDraftChange(result.draft);
    }
  }

  function disconnect(from: string, to: string): void {
    const result = tryDisconnectWorkflowEdge(draft, from, to);
    setFeedback({
      tone: result.ok ? "info" : "error",
      message: result.message,
    });
    if (result.ok) {
      onDraftChange(result.draft);
    }
  }

  if (draft.definition.nodes.length === 0) {
    return (
      <p className="muted workflow-studio-keyboard-graph-empty">
        Add steps before connecting them.
      </p>
    );
  }

  return (
    <div
      className="workflow-studio-keyboard-graph"
      data-testid="workflow-keyboard-graph-panel"
    >
      <p className="muted workflow-studio-keyboard-graph-lead">
        Connect steps without drag-and-drop. Invalid connections are rejected
        with an explanation.
      </p>
      <div className="workflow-studio-keyboard-graph-fields">
        <div className="field">
          <label htmlFor="workflow-connect-source">Source step</label>
          <select
            id="workflow-connect-source"
            value={sourceKey}
            disabled={disabled}
            onChange={(event) => setSourceKey(event.target.value)}
          >
            <option value="">Select source…</option>
            {draft.definition.nodes.map((node) => (
              <option key={node.key} value={node.key}>
                {stepLabel(node.key)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="workflow-connect-target">Destination step</label>
          <select
            id="workflow-connect-target"
            value={targetKey}
            disabled={disabled}
            onChange={(event) => setTargetKey(event.target.value)}
          >
            <option value="">Select destination…</option>
            {draft.definition.nodes.map((node) => (
              <option key={node.key} value={node.key}>
                {stepLabel(node.key)}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={connect}
        >
          Connect steps
        </Button>
      </div>
      {feedback !== undefined ? (
        <InlineMessage tone={feedback.tone === "error" ? "error" : "info"}>
          {feedback.message}
        </InlineMessage>
      ) : null}
      {draft.definition.edges.length > 0 ? (
        <>
          <h4 className="workflow-studio-keyboard-graph-subtitle">
            Current connections
          </h4>
          <ul className="workflow-studio-keyboard-graph-edges">
            {draft.definition.edges.map((edge) => (
              <li key={`${edge.from}-${edge.to}`}>
                <span>
                  {edge.from} → {edge.to}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={disabled}
                  aria-label={`Remove connection ${edge.from} to ${edge.to}`}
                  onClick={() => disconnect(edge.from, edge.to)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
