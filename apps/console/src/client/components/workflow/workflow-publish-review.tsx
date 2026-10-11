import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-draft";
import type { WorkflowBuilderValidationReport } from "../../lib/workflow-builder-validation";
import { summarizeDefinition } from "../../lib/workflow-builder-validation";

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
  const summary = summarizeDefinition(draft.definition);
  const typeEntries = Object.entries(summary.nodeTypes).sort(
    ([left], [right]) => left.localeCompare(right),
  );

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
        Confirm this immutable WorkflowVersion. Published versions cannot be
        edited.
      </p>
      <dl className="meta-grid">
        <div>
          <dt>Key</dt>
          <dd className="mono">{draft.registry.key || "(missing)"}</dd>
        </div>
        <div>
          <dt>Name</dt>
          <dd>{draft.registry.name || "(missing)"}</dd>
        </div>
        <div>
          <dt>Nodes</dt>
          <dd>{summary.nodeCount}</dd>
        </div>
        <div>
          <dt>Edges</dt>
          <dd>{summary.edgeCount}</dd>
        </div>
      </dl>
      <h3 className="panel-title">Node types</h3>
      {typeEntries.length === 0 ? (
        <p className="muted">No nodes.</p>
      ) : (
        <ul>
          {typeEntries.map(([type, count]) => (
            <li key={type}>
              {type}: {count}
            </li>
          ))}
        </ul>
      )}
      <h3 className="panel-title">Agent version bindings</h3>
      {summary.agentBindings.length === 0 ? (
        <p className="muted">No AGENT nodes.</p>
      ) : (
        <ul>
          {summary.agentBindings.map((binding) => (
            <li key={binding.nodeKey} className="mono">
              {binding.nodeKey}: {binding.agentVersionId || "(unbound)"}
            </li>
          ))}
        </ul>
      )}
      <p data-testid="workflow-publish-review-validation">
        {report.canPublish
          ? "Client validation passed. Control-plane validation remains authoritative."
          : `${String(report.errorCount)} client validation error${report.errorCount === 1 ? "" : "s"} block publish.`}
      </p>
      <div className="stack" style={{ flexDirection: "row", gap: 8 }}>
        <button
          type="button"
          className="button primary"
          disabled={!report.canPublish || publishing}
          onClick={onConfirm}
        >
          {retry ? "Confirm retry publish" : "Confirm publish"}
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
