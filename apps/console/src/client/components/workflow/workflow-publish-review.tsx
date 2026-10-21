import { useWorkflowCanvasLabelContext } from "../../hooks/use-workflow-canvas-label-context";
import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-draft";
import { buildWorkflowPublishStepSummaries } from "../../lib/workflow-publish-summary";
import type { WorkflowBuilderValidationReport } from "../../lib/workflow-builder-validation";
import { summarizeDefinition } from "../../lib/workflow-builder-validation";
import {
  asWorkflowDefinitionView,
  orderWorkflowNodeKeys,
} from "../../lib/workflow-definition";

export interface WorkflowPublishReviewProps {
  readonly draft: WorkflowBuilderDraft;
  readonly report: WorkflowBuilderValidationReport;
  readonly publishing: boolean;
  readonly retry: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function WorkflowPublishReview({
  draft,
  report,
  publishing,
  retry,
  onCancel,
  onConfirm,
}: WorkflowPublishReviewProps) {
  const labelContext = useWorkflowCanvasLabelContext();
  const summary = summarizeDefinition(draft.definition);
  const steps = buildWorkflowPublishStepSummaries(
    draft.definition,
    labelContext,
  );
  const orderedKeys = orderWorkflowNodeKeys(
    asWorkflowDefinitionView(draft.definition),
  );
  const hasParallelism =
    draft.definition.nodes.some((node) => node.type === "PARALLEL") ||
    draft.definition.nodes.some((node) => node.type === "JOIN") ||
    draft.definition.nodes.some((node) => node.type === "BRANCH");

  return (
    <section
      className="panel"
      data-testid="workflow-publish-review"
      aria-labelledby="workflow-publish-review-title"
    >
      <h2 className="section-title" id="workflow-publish-review-title">
        Publish review
      </h2>
      <p className="muted">
        Publishing creates an immutable workflow version. Existing published
        versions stay unchanged and remain available for runs.
      </p>
      <dl className="meta-grid">
        <div>
          <dt>Workflow name</dt>
          <dd>{draft.registry.name || "(missing)"}</dd>
        </div>
        <div>
          <dt>Key</dt>
          <dd className="mono">{draft.registry.key || "(missing)"}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>{summary.nodeCount}</dd>
        </div>
        <div>
          <dt>Connections</dt>
          <dd>{summary.edgeCount}</dd>
        </div>
      </dl>

      <h3 className="panel-title">Steps in this version</h3>
      {hasParallelism ? (
        <p className="muted">
          This graph includes branches or parallel paths. Execution order
          depends on runtime decisions, not a single linear list.
        </p>
      ) : orderedKeys.length > 0 ? (
        <p className="muted">
          Typical entry-to-exit order for this graph (one possible path):
        </p>
      ) : null}
      {steps.length === 0 ? (
        <p className="muted">No steps configured.</p>
      ) : (
        <ol className="stack">
          {steps.map((step) => (
            <li key={step.nodeKey}>
              <strong>{step.type}</strong>: {step.presentationLabel}
              <p className="muted">{step.detail}</p>
              <p className="mono">{step.nodeKey}</p>
            </li>
          ))}
        </ol>
      )}

      <p data-testid="workflow-publish-review-validation">
        {report.canPublish
          ? "Validation passed in the Console. The control plane performs a final check when you confirm."
          : `${String(report.errorCount)} issue${report.errorCount === 1 ? "" : "s"} must be fixed before publishing.`}
      </p>
      <div className="stack" style={{ flexDirection: "row", gap: 8 }}>
        <button
          type="button"
          className="button primary"
          disabled={!report.canPublish || publishing}
          onClick={onConfirm}
        >
          {retry ? "Confirm publish new version" : "Confirm publish"}
        </button>
        <button
          type="button"
          className="button"
          disabled={publishing}
          onClick={onCancel}
        >
          Back to editor
        </button>
      </div>
    </section>
  );
}
