import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { ConfirmDialog } from "../ui/confirm-dialog";
import { Button, LinkButton } from "../ui/button";
import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-draft";
import {
  applyWorkflowBuilderTemplate,
  type WorkflowBuilderTemplateId,
} from "../../lib/workflow-builder-templates";
import { validateDraftForPublish } from "../../lib/workflow-builder-linear";
import { WorkflowPublishReview } from "./workflow-publish-review";
import { WorkflowStudioDetailsDialog } from "./workflow-studio-details-dialog";
import { WorkflowStudioEditor } from "./workflow-studio-editor";
import { WorkflowStudioTemplatesDialog } from "./workflow-studio-templates-dialog";

export interface WorkflowStudioV2WorkspaceProps {
  readonly mode: "create" | "newVersion";
  readonly draft: WorkflowBuilderDraft;
  readonly onDraftChange: (draft: WorkflowBuilderDraft) => void;
  readonly registryLocked: boolean;
  readonly disabled: boolean;
  readonly canWrite: boolean;
  readonly backLink: { readonly to: string; readonly label: string };
  readonly publishing: boolean;
  readonly reviewOpen: boolean;
  readonly onReviewOpenChange: (open: boolean) => void;
  readonly onPublish: () => void | Promise<void>;
  readonly partialPublishFailure: boolean;
  readonly feedback?: string;
  readonly errorRequestId?: string;
  readonly banner?: ReactNode;
  readonly initialTemplatesOpen?: boolean;
  readonly headerExtra?: ReactNode;
}

export function WorkflowStudioV2Workspace({
  mode,
  draft,
  onDraftChange,
  registryLocked,
  disabled,
  canWrite,
  backLink,
  publishing,
  reviewOpen,
  onReviewOpenChange,
  onPublish,
  partialPublishFailure,
  feedback,
  errorRequestId,
  banner,
  initialTemplatesOpen = false,
  headerExtra,
}: WorkflowStudioV2WorkspaceProps) {
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | undefined>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(initialTemplatesOpen);
  const [templateConfirmId, setTemplateConfirmId] = useState<
    WorkflowBuilderTemplateId | undefined
  >();
  const [keyTouched, setKeyTouched] = useState(registryLocked);
  const [focusMode, setFocusMode] = useState(false);
  const [focusPaletteOpen, setFocusPaletteOpen] = useState(false);
  const [focusInspectorOpen, setFocusInspectorOpen] = useState(false);
  const [showAdvanced] = useState(false);

  useEffect(() => {
    setSelectedNodeKey(undefined);
    setInspectorOpen(false);
    setKeyTouched(registryLocked);
  }, [draft.draftId, registryLocked]);

  function enterFocusMode(): void {
    setFocusMode(true);
    setFocusPaletteOpen(false);
    setFocusInspectorOpen(false);
  }

  function exitFocusMode(): void {
    setFocusMode(false);
    setFocusPaletteOpen(false);
    setFocusInspectorOpen(false);
  }

  useEffect(() => {
    if (!focusMode) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitFocusMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [focusMode]);

  const displayName =
    draft.registry.name.trim().length > 0
      ? draft.registry.name.trim()
      : mode === "create"
        ? "Untitled workflow"
        : "Workflow version draft";

  const publishValidation = validateDraftForPublish(draft);

  function requestApplyTemplate(templateId: WorkflowBuilderTemplateId) {
    const hasContent =
      draft.definition.nodes.length > 0 ||
      draft.registry.name.trim().length > 0 ||
      draft.registry.key.trim().length > 0;
    if (hasContent) {
      setTemplateConfirmId(templateId);
      return;
    }
    commitTemplate(templateId);
  }

  function commitTemplate(templateId: WorkflowBuilderTemplateId) {
    onDraftChange(applyWorkflowBuilderTemplate(draft, templateId));
    setTemplateConfirmId(undefined);
    onReviewOpenChange(false);
  }

  const publishLabel =
    draft.createdWorkflowId !== undefined
      ? "Review and publish new version"
      : "Review and publish";

  return (
    <div
      className={`workflow-studio-v2${focusMode ? " workflow-studio-v2--focus" : ""}`}
      data-testid="workflow-studio-v2"
    >
      {!focusMode ? (
        <header className="workflow-studio-header">
          <div className="workflow-studio-header-main">
            <LinkButton to={backLink.to} variant="secondary">
              {backLink.label}
            </LinkButton>
            <div>
              <h1 className="workflow-studio-title">{displayName}</h1>
              <p className="muted workflow-studio-subtitle">
                {draft.createdWorkflowId !== undefined
                  ? "Draft · workflow registered · version not published yet"
                  : "Draft · not published"}
              </p>
            </div>
          </div>
          <div className="workflow-studio-header-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDetailsOpen(true)}
            >
              Edit details
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTemplatesOpen(true)}
              disabled={!canWrite || disabled}
            >
              Templates
            </Button>
            <Button type="button" variant="secondary" onClick={enterFocusMode}>
              Focus mode
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canWrite || disabled || publishing}
              onClick={() => {
                onReviewOpenChange(true);
              }}
            >
              {publishLabel}
            </Button>
          </div>
        </header>
      ) : (
        <div className="workflow-studio-focus-bar">
          <span className="workflow-studio-title">{displayName}</span>
          <div className="workflow-studio-header-actions">
            <Button type="button" variant="secondary" onClick={exitFocusMode}>
              Exit focus
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canWrite || disabled || publishing}
              onClick={() => onReviewOpenChange(true)}
            >
              {publishLabel}
            </Button>
          </div>
        </div>
      )}

      {!canWrite ? (
        <p className="muted workflow-studio-readonly-note">
          Your role cannot publish workflows (EDITOR or ADMIN required).
        </p>
      ) : null}

      {banner}

      {headerExtra}

      {partialPublishFailure && draft.createdWorkflowId !== undefined ? (
        <section className="workflow-studio-banner panel">
          <p>
            Workflow{" "}
            <Link className="mono" to={`/workflows/${draft.createdWorkflowId}`}>
              {draft.createdWorkflowId}
            </Link>{" "}
            exists, but publishing the version failed. Fix validation issues and{" "}
            <strong>retry publishing</strong> without creating another workflow.
          </p>
        </section>
      ) : null}

      {feedback !== undefined ? (
        <section className="workflow-studio-banner panel">
          <p data-testid="workflow-publish-upstream-error">
            Publication failed on the control plane. {feedback}
          </p>
          {errorRequestId !== undefined ? (
            <p className="mono">Request ID: {errorRequestId}</p>
          ) : null}
        </section>
      ) : null}

      <WorkflowStudioEditor
        draft={draft}
        onDraftChange={onDraftChange}
        disabled={disabled}
        selectedNodeKey={selectedNodeKey}
        onSelectNodeKey={setSelectedNodeKey}
        onOpenRegistryDetails={() => setDetailsOpen(true)}
        inspectorOpen={inspectorOpen}
        onInspectorOpenChange={setInspectorOpen}
        showAdvanced={showAdvanced}
        focusMode={focusMode}
        focusPaletteOpen={focusPaletteOpen}
        onFocusPaletteOpenChange={setFocusPaletteOpen}
        focusInspectorOpen={focusInspectorOpen}
        onFocusInspectorOpenChange={setFocusInspectorOpen}
      />

      <WorkflowStudioDetailsDialog
        open={detailsOpen}
        draft={draft}
        registryLocked={registryLocked}
        disabled={disabled}
        keyTouched={keyTouched}
        onKeyTouched={() => setKeyTouched(true)}
        onDraftChange={onDraftChange}
        onClose={() => setDetailsOpen(false)}
      />

      <WorkflowStudioTemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onApply={(templateId) => requestApplyTemplate(templateId)}
      />

      <ConfirmDialog
        open={templateConfirmId !== undefined}
        title="Replace current draft?"
        description="Applying this template replaces steps and layout in your current draft. Nothing is published until you confirm in review."
        confirmLabel="Replace draft"
        destructive
        onCancel={() => setTemplateConfirmId(undefined)}
        onConfirm={() => {
          if (templateConfirmId !== undefined) {
            commitTemplate(templateConfirmId);
          }
        }}
      />

      {reviewOpen ? (
        <div
          className="dialog-root"
          data-testid="workflow-publish-review-dialog"
        >
          <div
            className="dialog-overlay"
            aria-hidden="true"
            onClick={() => !publishing && onReviewOpenChange(false)}
          />
          <div
            className="dialog-panel workflow-studio-publish-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-publish-review-title"
          >
            <WorkflowPublishReview
              draft={draft}
              report={publishValidation.report}
              publishing={publishing}
              retry={draft.createdWorkflowId !== undefined}
              onCancel={() => onReviewOpenChange(false)}
              onConfirm={() => void onPublish()}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
