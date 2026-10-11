import { useState } from "react";

import type { WorkflowBuilderValidationReport } from "../../lib/workflow-builder-validation";

export interface WorkflowValidationPanelProps {
  readonly report: WorkflowBuilderValidationReport;
  readonly onFocusNode: (nodeKey: string) => void;
}

export function WorkflowValidationPanel({
  report,
  onFocusNode,
}: WorkflowValidationPanelProps) {
  const [open, setOpen] = useState(true);
  const status =
    report.errorCount === 0
      ? "No blocking errors. Review before publishing."
      : `${String(report.errorCount)} error${report.errorCount === 1 ? "" : "s"} must be fixed before publish.`;

  return (
    <section
      className="panel"
      data-testid="workflow-validation-panel"
      aria-labelledby="workflow-validation-title"
    >
      <div className="page-header">
        <h2 className="section-title" id="workflow-validation-title">
          Validation
        </h2>
        <button
          type="button"
          className="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      <p
        className={
          report.errorCount === 0 ? "muted" : "workflow-validation-count"
        }
        data-testid="workflow-validation-summary"
      >
        {status}
        {report.warningCount > 0
          ? ` ${String(report.warningCount)} warning${report.warningCount === 1 ? "" : "s"}.`
          : ""}
      </p>
      {open ? (
        <ul className="stack workflow-validation-list">
          {report.issues.length === 0 ? (
            <li className="muted">No validation issues.</li>
          ) : (
            report.issues.map((item) => {
              const focusKeys = [
                ...(item.nodeKey !== undefined ? [item.nodeKey] : []),
                ...(item.relatedNodeKeys ?? []).filter(
                  (key) => key !== item.nodeKey,
                ),
              ];
              return (
                <li key={item.id} className="workflow-validation-item">
                  <strong className="workflow-validation-item__severity">
                    {item.severity}
                  </strong>
                  <span>{item.message}</span>
                  <p className="muted" style={{ margin: "4px 0 0" }}>
                    {item.action}
                    {item.edge !== undefined
                      ? ` Edge ${item.edge.from} → ${item.edge.to}.`
                      : ""}
                  </p>
                  {focusKeys.length > 0 ? (
                    <div
                      className="stack"
                      style={{ flexDirection: "row", gap: 8, marginTop: 8 }}
                    >
                      {focusKeys.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className="button"
                          onClick={() => onFocusNode(key)}
                        >
                          Focus {key}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </section>
  );
}
