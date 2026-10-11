import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { WorkflowBuilderForm } from "../components/workflow/workflow-builder-form";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useAppendWorkflowVersionMutation,
  useCreateWorkflowMutation,
} from "../hooks/use-workflows";
import { ConsoleApiError } from "../lib/console-api";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import {
  createEmptyWorkflowBuilderDraft,
  setCreatedWorkflowId,
  validateDraftForPublish,
  type WorkflowBuilderDraft,
} from "../lib/workflow-builder-linear";
import {
  clearStoredWorkflowBuilderDraft,
  draftsConflict,
  readStoredWorkflowBuilderDraft,
  writeStoredWorkflowBuilderDraft,
} from "../lib/workflow-builder-storage";

export function WorkflowCreatePage() {
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const createWorkflowMutation = useCreateWorkflowMutation();
  const [draft, setDraft] = useState<WorkflowBuilderDraft | undefined>();
  const [storedDraftOffer, setStoredDraftOffer] = useState<
    WorkflowBuilderDraft | undefined
  >();
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [partialPublishFailure, setPartialPublishFailure] = useState(false);

  const appendVersionMutation = useAppendWorkflowVersionMutation();

  useEffect(() => {
    if (authQuery.data === undefined) {
      return;
    }
    const workspaceId = authQuery.data.workspaceId;
    const stored = readStoredWorkflowBuilderDraft(workspaceId);
    const fresh = createEmptyWorkflowBuilderDraft(workspaceId);
    if (stored === undefined) {
      setDraft(fresh);
      return;
    }
    setDraft(fresh);
    setStoredDraftOffer(stored.envelope.draft);
  }, [authQuery.data?.workspaceId]);

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
  }

  function discardStoredDraft() {
    if (authQuery.data === undefined) {
      return;
    }
    clearStoredWorkflowBuilderDraft(authQuery.data.workspaceId);
    setStoredDraftOffer(undefined);
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
      setFeedback(validation.message);
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
      clearStoredWorkflowBuilderDraft(draft.workspaceId);
      navigate(`/workflows/${workflowId}/versions/${version.id}`, {
        replace: true,
      });
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

  const showRestoreBanner =
    storedDraftOffer !== undefined &&
    draftsConflict(draft.draftId, {
      version: 1,
      draft: storedDraftOffer,
    });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Create workflow</h1>
          <p className="page-subtitle">
            Register a workflow and publish an immutable V3 graph definition.
          </p>
        </div>
        <Link className="button" to="/workflows">
          All workflows
        </Link>
      </header>

      {!canWrite ? (
        <p className="muted">
          Your API key role cannot create workflows (EDITOR or ADMIN required).
        </p>
      ) : null}

      {showRestoreBanner ? (
        <section className="panel">
          <p>
            A saved draft exists for this workspace (
            <span className="mono">{storedDraftOffer.draftId}</span>). Restore
            it explicitly; your current draft will not be overwritten
            automatically.
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
            Workflow registry row{" "}
            <Link className="mono" to={`/workflows/${draft.createdWorkflowId}`}>
              {draft.createdWorkflowId}
            </Link>{" "}
            was created, but publishing the version failed. Fix the definition
            and retry publication without creating a duplicate workflow.
          </p>
        </section>
      ) : null}

      <WorkflowBuilderForm
        draft={draft}
        onDraftChange={setDraft}
        registryLocked={draft.createdWorkflowId !== undefined}
        disabled={!canWrite || publishing}
      />

      <section className="panel">
        <button
          type="button"
          className="button primary"
          disabled={!canWrite || publishing}
          onClick={() => void publish()}
        >
          {draft.createdWorkflowId !== undefined
            ? "Retry publish version"
            : "Create workflow and publish version"}
        </button>
        {feedback !== undefined ? <p>{feedback}</p> : null}
        {errorRequestId !== undefined ? (
          <p className="mono">Request ID: {errorRequestId}</p>
        ) : null}
      </section>
    </>
  );
}
