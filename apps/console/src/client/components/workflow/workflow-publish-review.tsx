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

  const blockingIssues = report.issues.filter(
    (item) => item.severity === "error",
  );

  return (
    <section
      className="workflow-publish-review"
      data-testid="workflow-publish-review"
      aria-labelledby="workflow-publish-review-title"
    >
      <h2 className="section-title" id="workflow-publish-review-title">
        {retry ? "Retry publishing" : "Publish review"}
      </h2>
      <p className="muted workflow-publish-review-lead">
        Publishing creates an immutable workflow version. It does not run the
        workflow. Existing published versions stay unchanged.
      </p>

      <dl className="workflow-publish-review-summary">
        <div>
          <dt>Workflow</dt>
          <dd>{draft.registry.name.trim() || "(name required)"}</dd>
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

      <h3 className="workflow-publish-review-subtitle">What will run</h3>
      {hasParallelism ? (
        <p className="muted">
          This graph includes branches or parallel paths. Runtime order depends
          on decisions and parallel completion, not one fixed list.
        </p>
      ) : orderedKeys.length > 0 ? (
        <p className="muted">One possible entry-to-exit path for this graph:</p>
      ) : null}
      {steps.length === 0 ? (
        <p className="muted">No steps configured yet.</p>
      ) : (
        <ol className="workflow-publish-review-steps">
          {steps.map((step) => (
            <li key={step.nodeKey}>
              <strong>{step.presentationLabel}</strong>
              <span className="workflow-publish-review-step-type muted">
                {step.type}
              </span>
              {step.detail.trim().length > 0 ? (
                <p className="muted">{step.detail}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {blockingIssues.length > 0 ? (
        <div
          className="workflow-publish-review-blockers"
          data-testid="workflow-publish-review-blockers"
        >
          <h3 className="workflow-publish-review-subtitle">Blocking issues</h3>
          <ul>
            {blockingIssues.map((item) => (
              <li key={item.id}>{item.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p
        className="workflow-publish-review-validation"
        data-testid="workflow-publish-review-validation"
      >
        {report.canPublish
          ? "This draft passes Console validation. The control plane performs a final check when you confirm."
          : `${String(report.errorCount)} issue${report.errorCount === 1 ? "" : "s"} must be fixed before publishing.`}
      </p>

      <details className="workflow-studio-tech-details">
        <summary>Technical details</summary>
        <dl className="meta-grid">
          <div>
            <dt>Registry key</dt>
            <dd className="mono">{draft.registry.key || "(missing)"}</dd>
          </div>
          {draft.createdWorkflowId !== undefined ? (
            <div>
              <dt>Workflow id</dt>
              <dd className="mono">{draft.createdWorkflowId}</dd>
            </div>
          ) : null}
        </dl>
        {steps.length > 0 ? (
          <ul className="workflow-publish-review-tech-keys">
            {steps.map((step) => (
              <li key={step.nodeKey} className="mono">
                {step.nodeKey}
              </li>
            ))}
          </ul>
        ) : null}
      </details>

      <div className="workflow-publish-review-actions">
        <button
          type="button"
          className="button primary"
          disabled={!report.canPublish || publishing}
          onClick={onConfirm}
        >
          {retry ? "Retry publishing" : "Confirm publish"}
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
