import { useState } from "react";

import type { WorkflowBuilderValidationReport } from "../../lib/workflow-builder-validation";
import { OnboardingRecoveryDialog } from "../onboarding/onboarding-recovery-dialog";
import { Button } from "../ui/button";

export interface WorkflowValidationBarProps {
  readonly report: WorkflowBuilderValidationReport;
  readonly onFocusNode: (nodeKey: string) => void;
  readonly onFocusRegistry: () => void;
  readonly draftStatusLabel: string;
}

export function WorkflowValidationBar({
  report,
  onFocusNode,
  onFocusRegistry,
  draftStatusLabel,
}: WorkflowValidationBarProps) {
  const [issuesOpen, setIssuesOpen] = useState(false);
  const actionableCount = report.errorCount;
  const status =
    actionableCount === 0
      ? "No blocking issues in this draft."
      : `${String(actionableCount)} issue${actionableCount === 1 ? "" : "s"} to fix before publish.`;

  function focusIssue(nodeKey: string | undefined, scope: string): void {
    setIssuesOpen(false);
    if (scope === "registry") {
      onFocusRegistry();
      return;
    }
    if (nodeKey !== undefined) {
      onFocusNode(nodeKey);
    }
  }

  return (
    <>
      <footer
        className="workflow-studio-validation-bar"
        data-testid="workflow-validation-panel"
        aria-live="polite"
      >
        <div className="workflow-studio-validation-bar-main">
          <span className="workflow-studio-validation-bar-status">
            {draftStatusLabel}
          </span>
          <span
            className={
              actionableCount === 0
                ? "workflow-studio-validation-bar-summary muted"
                : "workflow-studio-validation-bar-summary workflow-studio-validation-bar-summary--warn"
            }
            data-testid="workflow-validation-summary"
          >
            {status}
            {report.warningCount > 0
              ? ` ${String(report.warningCount)} warning${report.warningCount === 1 ? "" : "s"}.`
              : ""}
          </span>
        </div>
        <div className="workflow-studio-validation-bar-actions">
          {report.issues.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIssuesOpen(true)}
            >
              View issues
            </Button>
          ) : null}
        </div>
      </footer>

      <OnboardingRecoveryDialog
        open={issuesOpen}
        title="Workflow issues"
        description="Fix each item before publishing. The control plane performs a final validation when you confirm."
        onClose={() => setIssuesOpen(false)}
      >
        <ul className="stack workflow-validation-list">
          {report.issues.map((item) => {
            const focusKeys = [
              ...(item.nodeKey !== undefined ? [item.nodeKey] : []),
              ...(item.relatedNodeKeys ?? []).filter(
                (key) => key !== item.nodeKey,
              ),
            ];
            const fixTarget =
              item.scope === "registry"
                ? undefined
                : (item.nodeKey ?? focusKeys[0]);
            return (
              <li key={item.id} className="workflow-validation-item">
                <strong className="workflow-validation-item__severity">
                  {item.severity}
                </strong>
                <span>{item.message}</span>
                <p className="muted workflow-validation-item-action">
                  {item.action}
                  {item.edge !== undefined
                    ? ` Edge ${item.edge.from} → ${item.edge.to}.`
                    : ""}
                </p>
                {fixTarget !== undefined || item.scope === "registry" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    data-testid={
                      fixTarget !== undefined
                        ? `workflow-validation-fix-${fixTarget}`
                        : "workflow-validation-fix-registry"
                    }
                    aria-label={
                      fixTarget !== undefined
                        ? `Fix ${fixTarget}`
                        : "Fix workflow details"
                    }
                    onClick={() => focusIssue(fixTarget, item.scope)}
                  >
                    Fix this
                  </Button>
                ) : null}
                {focusKeys.length > 1
                  ? focusKeys.slice(1).map((key) => (
                      <Button
                        key={key}
                        type="button"
                        variant="secondary"
                        aria-label={`Fix ${key}`}
                        onClick={() => focusIssue(key, item.scope)}
                      >
                        Fix {key}
                      </Button>
                    ))
                  : null}
              </li>
            );
          })}
        </ul>
      </OnboardingRecoveryDialog>
    </>
  );
}
