import { useEffect, useState, type ReactNode } from "react";

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
import { WorkflowStudioV2Workspace } from "./workflow-studio-v2-workspace";

export interface WorkflowBuilderWorkspaceProps {
  readonly mode: "create" | "newVersion";
  readonly title: string;
  readonly subtitle: string;
  readonly initialDraft: WorkflowBuilderDraft | undefined;
  readonly handoffSearchParams?: URLSearchParams;
  readonly backLink: { readonly to: string; readonly label: string };
  readonly initialTemplatesOpen?: boolean;
  readonly headerExtra?: ReactNode;
  readonly onPublished: (input: {
    readonly workflowId: string;
    readonly versionId: string;
  }) => void;
}

export function WorkflowBuilderWorkspace({
  mode,
  initialDraft,
  handoffSearchParams,
  backLink,
  initialTemplatesOpen,
  headerExtra,
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

  const restoreBanner =
    storedDraftOffer !== undefined ? (
      <section className="workflow-studio-banner panel">
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
          <button type="button" className="button" onClick={discardStoredDraft}>
            Discard saved draft
          </button>
        </div>
      </section>
    ) : null;

  const handoffBanner =
    handoff.agentVersionId !== undefined ? (
      <section className="workflow-studio-banner panel">
        <h2 className="panel-title">Agent version handoff</h2>
        <p className="muted">
          Add an <strong>AI agent</strong> step, select the agent, then choose
          version <span className="mono">{handoff.agentVersionId}</span>.
        </p>
      </section>
    ) : null;

  return (
    <WorkflowStudioV2Workspace
      mode={mode}
      draft={draft}
      onDraftChange={setDraft}
      registryLocked={registryLocked}
      disabled={!canWrite || publishing}
      canWrite={canWrite}
      backLink={backLink}
      publishing={publishing}
      reviewOpen={reviewOpen}
      onReviewOpenChange={setReviewOpen}
      onPublish={publish}
      partialPublishFailure={partialPublishFailure}
      feedback={feedback}
      errorRequestId={errorRequestId}
      initialTemplatesOpen={initialTemplatesOpen}
      headerExtra={headerExtra}
      banner={
        <>
          {handoffBanner}
          {restoreBanner}
        </>
      }
    />
  );
}
