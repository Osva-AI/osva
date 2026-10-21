import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { WorkflowBuilderForm } from "./workflow-builder-form";
import { WorkflowPublishReview } from "./workflow-publish-review";
import { ErrorState } from "../error-state/error-state";
import { LoadingBlock } from "../loading/loading-block";
import { useAuthContextQuery } from "../../hooks/use-auth-context";
import {
  useAppendWorkflowVersionMutation,
  useCreateWorkflowMutation,
} from "../../hooks/use-workflows";
import { parseBuilderHandoff } from "../../lib/builder-handoff";
import { ConsoleApiError } from "../../lib/console-api";
import { roleCanWriteControlPlaneResources } from "../../lib/permissions";
import {
  setCreatedWorkflowId,
  validateDraftForPublish,
  type WorkflowBuilderDraft,
} from "../../lib/workflow-builder-linear";
import {
  clearStoredWorkflowBuilderDraft,
  draftsConflict,
  readStoredWorkflowBuilderDraft,
  writeStoredWorkflowBuilderDraft,
} from "../../lib/workflow-builder-storage";
import {
  applyWorkflowBuilderTemplate,
  WORKFLOW_BUILDER_TEMPLATES,
  type WorkflowBuilderTemplateId,
} from "../../lib/workflow-builder-templates";

export interface WorkflowBuilderWorkspaceProps {
  readonly mode: "create" | "newVersion";
  readonly title: string;
  readonly subtitle: string;
  readonly initialDraft: WorkflowBuilderDraft | undefined;
  readonly handoffSearchParams?: URLSearchParams;
  readonly backLink: { readonly to: string; readonly label: string };
  readonly onPublished: (input: {
    readonly workflowId: string;
    readonly versionId: string;
  }) => void;
}

export function WorkflowBuilderWorkspace({
  mode,
  title,
  subtitle,
  initialDraft,
  handoffSearchParams,
  backLink,
  onPublished,
}: WorkflowBuilderWorkspaceProps) {
  const handoff =
    handoffSearchParams === undefined
      ? { agentId: undefined, agentVersionId: undefined }
      : parseBuilderHandoff(handoffSearchParams);
  const authQuery = useAuthContextQuery();
  const createWorkflowMutation = useCreateWorkflowMutation();
  const appendVersionMutation = useAppendWorkflowVersionMutation();

  const [draft, setDraft] = useState<WorkflowBuilderDraft | undefined>(
    initialDraft,
  );
  const [storedDraftOffer, setStoredDraftOffer] = useState<
    WorkflowBuilderDraft | undefined
  >();
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [partialPublishFailure, setPartialPublishFailure] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    if (initialDraft !== undefined) {
      setDraft(initialDraft);
    }
  }, [initialDraft?.draftId]);

  useEffect(() => {
    if (authQuery.data === undefined || draft === undefined) {
      return;
    }
    if (draft.workspaceId !== authQuery.data.workspaceId) {
      return;
    }
    const stored = readStoredWorkflowBuilderDraft(
      authQuery.data.workspaceId,
      draft,
    );
    if (
      stored !== undefined &&
      draftsConflict(draft.draftId, stored.envelope)
    ) {
      setStoredDraftOffer(stored.envelope.draft);
    }
  }, [authQuery.data?.workspaceId, draft?.draftId, draft?.editContext]);

  useEffect(() => {
    if (draft === undefined || authQuery.data === undefined) {
      return;
    }
    if (draft.workspaceId !== authQuery.data.workspaceId) {
      return;
    }
    writeStoredWorkflowBuilderDraft(draft);
  }, [draft, authQuery.data?.workspaceId]);

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const publishing =
    createWorkflowMutation.isPending || appendVersionMutation.isPending;

  const registryLocked =
    mode === "newVersion" || draft?.createdWorkflowId !== undefined;

  if (authQuery.isLoading || draft === undefined) {
    return <LoadingBlock label="Loading workflow builder…" />;
  }

  if (authQuery.isError) {
    return <ErrorState title="Authentication failed" error={authQuery.error} />;
  }

  function restoreStoredDraft() {
    if (storedDraftOffer === undefined) {
      return;
    }
    setDraft(storedDraftOffer);
    setStoredDraftOffer(undefined);
    setFeedback(undefined);
    setPartialPublishFailure(false);
    setReviewOpen(false);
  }

  function discardStoredDraft() {
    if (authQuery.data === undefined || draft === undefined) {
      return;
    }
    clearStoredWorkflowBuilderDraft(authQuery.data.workspaceId, draft);
    setStoredDraftOffer(undefined);
  }

  function applyTemplate(templateId: WorkflowBuilderTemplateId) {
    setDraft((current) =>
      current === undefined
        ? current
        : applyWorkflowBuilderTemplate(current, templateId),
    );
    setReviewOpen(false);
  }

  async function publish() {
    if (draft === undefined || !canWrite) {
      return;
    }
    setFeedback(undefined);
    setErrorRequestId(undefined);
    setPartialPublishFailure(false);

    const validation = validateDraftForPublish(draft);
    if (!validation.ok) {
      setReviewOpen(true);
      return;
    }

    let workflowId = draft.createdWorkflowId;
    try {
      if (workflowId === undefined) {
        const created = await createWorkflowMutation.mutateAsync({
          key: draft.registry.key.trim(),
          name: draft.registry.name.trim(),
          ...(draft.registry.description !== undefined &&
          draft.registry.description.trim().length > 0
            ? { description: draft.registry.description.trim() }
            : {}),
        });
        workflowId = created.id;
        setDraft((current) =>
          current === undefined
            ? current
            : setCreatedWorkflowId(current, workflowId!),
        );
      }

      const version = await appendVersionMutation.mutateAsync({
        workflowId,
        definition: validation.definition,
      });
      clearStoredWorkflowBuilderDraft(draft.workspaceId, draft);
      onPublished({ workflowId, versionId: version.id });
    } catch (error) {
      if (workflowId !== undefined) {
        setDraft((current) =>
          current === undefined
            ? current
            : setCreatedWorkflowId(current, workflowId!),
        );
        setPartialPublishFailure(true);
      }
      setFeedback(error instanceof Error ? error.message : "Publish failed.");
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  const showRestoreBanner = storedDraftOffer !== undefined;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <Link className="button" to={backLink.to}>
          {backLink.label}
        </Link>
      </header>

      {!canWrite ? (
        <p className="muted">
          Your role cannot publish workflows (EDITOR or ADMIN required).
        </p>
      ) : null}

      {handoff.agentVersionId !== undefined ? (
        <section className="panel">
          <h2 className="panel-title">Agent version handoff</h2>
          <p className="muted">
            Add a <strong>Run AI agent</strong> step, select the agent, then
            choose version{" "}
            <span className="mono">{handoff.agentVersionId}</span>.
          </p>
        </section>
      ) : null}

      {mode === "create" && draft.definition.nodes.length === 0 ? (
        <section className="panel" aria-labelledby="workflow-templates-title">
          <h2 className="panel-title" id="workflow-templates-title">
            Start from a template
          </h2>
          <p className="muted">
            Templates use supported step types only. Bind published agent
            versions before publishing.
          </p>
          <div className="stack" style={{ flexDirection: "row", gap: 8 }}>
            {WORKFLOW_BUILDER_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="button"
                disabled={!canWrite || publishing}
                onClick={() => applyTemplate(template.id)}
              >
                {template.name}
              </button>
            ))}
          </div>
          <ul className="muted">
            {WORKFLOW_BUILDER_TEMPLATES.map((template) => (
              <li key={template.id}>{template.description}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {showRestoreBanner ? (
        <section className="panel">
          <p>
            A saved draft exists for this editor session. Restore it explicitly;
            your current draft will not be overwritten automatically.
          </p>
          <div className="stack" style={{ flexDirection: "row", gap: 8 }}>
            <button
              type="button"
              className="button primary"
              onClick={restoreStoredDraft}
            >
              Restore saved draft
            </button>
            <button
              type="button"
              className="button"
              onClick={discardStoredDraft}
            >
              Discard saved draft
            </button>
          </div>
        </section>
      ) : null}

      {partialPublishFailure && draft.createdWorkflowId !== undefined ? (
        <section className="panel">
          <p>
            Workflow{" "}
            <Link className="mono" to={`/workflows/${draft.createdWorkflowId}`}>
              {draft.createdWorkflowId}
            </Link>{" "}
            exists, but publishing the version failed. Fix validation issues and
            retry without creating another workflow.
          </p>
        </section>
      ) : null}

      <WorkflowBuilderForm
        draft={draft}
        onDraftChange={setDraft}
        registryLocked={registryLocked}
        disabled={!canWrite || publishing}
      />

      {reviewOpen ? (
        <WorkflowPublishReview
          draft={draft}
          report={validateDraftForPublish(draft).report}
          publishing={publishing}
          retry={draft.createdWorkflowId !== undefined}
          onCancel={() => setReviewOpen(false)}
          onConfirm={() => void publish()}
        />
      ) : (
        <section className="panel">
          <button
            type="button"
            className="button primary"
            disabled={!canWrite || publishing}
            onClick={() => {
              setFeedback(undefined);
              setErrorRequestId(undefined);
              setReviewOpen(true);
            }}
          >
            {draft.createdWorkflowId !== undefined
              ? "Review and publish new version"
              : "Review and publish"}
          </button>
        </section>
      )}

      {feedback !== undefined ? (
        <section className="panel">
          <p data-testid="workflow-publish-upstream-error">
            Publication failed on the control plane. {feedback}
          </p>
          {errorRequestId !== undefined ? (
            <p className="mono">Request ID: {errorRequestId}</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
