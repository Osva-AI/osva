import { OnboardingRecoveryDialog } from "../onboarding/onboarding-recovery-dialog";
import { Button } from "../ui/button";
import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-draft";
import { updateRegistry } from "../../lib/workflow-builder-draft";
import { slugWorkflowKeyFromName } from "../../lib/workflow-builder-registry-key";

export function WorkflowStudioDetailsDialog({
  open,
  draft,
  registryLocked,
  disabled,
  keyTouched,
  onKeyTouched,
  onDraftChange,
  onClose,
}: {
  readonly open: boolean;
  readonly draft: WorkflowBuilderDraft;
  readonly registryLocked: boolean;
  readonly disabled: boolean;
  readonly keyTouched: boolean;
  readonly onKeyTouched: () => void;
  readonly onDraftChange: (draft: WorkflowBuilderDraft) => void;
  readonly onClose: () => void;
}) {
  return (
    <OnboardingRecoveryDialog
      open={open}
      title="Workflow details"
      description="Name your workflow for teammates. The registry key identifies this workflow in APIs and must stay stable after the first publish."
      onClose={onClose}
    >
      <div className="stack workflow-studio-details-form">
        <div className="field">
          <label htmlFor="workflow-studio-name">Name</label>
          <input
            id="workflow-studio-name"
            value={draft.registry.name}
            disabled={disabled}
            onChange={(event) => {
              const name = event.target.value;
              const patch: { name: string; key?: string } = { name };
              if (!registryLocked && !keyTouched) {
                patch.key = slugWorkflowKeyFromName(name);
              }
              onDraftChange(
                updateRegistry(draft, {
                  ...draft.registry,
                  ...patch,
                }),
              );
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="workflow-studio-key">Registry key</label>
          <input
            id="workflow-studio-key"
            className="mono"
            value={draft.registry.key}
            disabled={disabled || registryLocked}
            onChange={(event) => {
              onKeyTouched();
              onDraftChange(
                updateRegistry(draft, {
                  ...draft.registry,
                  key: event.target.value,
                }),
              );
            }}
          />
          {registryLocked ? (
            <p className="muted workflow-studio-details-hint">
              Key is locked for this workflow.
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="workflow-studio-description">
            Description (optional)
          </label>
          <textarea
            id="workflow-studio-description"
            rows={3}
            value={draft.registry.description ?? ""}
            disabled={disabled}
            onChange={(event) => {
              const description = event.target.value.trim();
              onDraftChange(
                updateRegistry(draft, {
                  ...draft.registry,
                  ...(description.length > 0 ? { description } : {}),
                }),
              );
            }}
          />
        </div>
        <details className="workflow-studio-tech-details">
          <summary>Technical details</summary>
          <dl className="meta-grid">
            <div>
              <dt>Draft id</dt>
              <dd className="mono">{draft.draftId}</dd>
            </div>
            {draft.createdWorkflowId !== undefined ? (
              <div>
                <dt>Workflow id</dt>
                <dd className="mono">{draft.createdWorkflowId}</dd>
              </div>
            ) : null}
          </dl>
        </details>
        <div className="dialog-actions workflow-studio-details-actions">
          <Button type="button" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </OnboardingRecoveryDialog>
  );
}
