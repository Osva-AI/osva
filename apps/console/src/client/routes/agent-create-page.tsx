import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AgentStudioV2Workspace } from "../components/agent/agent-studio-v2-workspace";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { PageHeader } from "../components/ui/page-header";
import { LinkButton } from "../components/ui/button";
import {
  useCreateAgentMutation,
  useCreateAgentVersionMutation,
} from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  defaultDeclarativeManifestTemplate,
  describeDeclarativeManifestValidation,
  manifestToText,
  parseManifestRecord,
  slugAgentKeyFromName,
} from "../lib/declarative-agent-manifest";
import { ConsoleApiError } from "../lib/console-api";
import {
  clearAgentStudioCreateDraft,
  readAgentStudioCreateDraft,
  writeAgentStudioCreateDraft,
} from "../lib/agent-studio-create-draft-storage";
import type { AgentStudioV2StageId } from "../lib/agent-studio-v2-stages";
import { describeControlPlaneWriteRoleRequirement } from "../lib/control-plane-access";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import type { AgentStudioEditorMode } from "../components/agent/declarative-agent-studio-editor";
import { getSelectedWorkspaceId } from "../lib/workspace-selection";

function readDraftField<T>(
  select: (
    draft: NonNullable<ReturnType<typeof readAgentStudioCreateDraft>>,
  ) => T,
  fallback: T,
): T {
  const workspaceId = getSelectedWorkspaceId();
  if (workspaceId === undefined) {
    return fallback;
  }
  const stored = readAgentStudioCreateDraft(workspaceId);
  if (stored === undefined) {
    return fallback;
  }
  return select(stored);
}

export function AgentCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const openTemplatesFromAgentsPage = searchParams.get("templates") === "1";
  const authQuery = useAuthContextQuery();
  const createAgent = useCreateAgentMutation();
  const createVersion = useCreateAgentVersionMutation();
  const submittingRef = useRef(false);

  const [agentName, setAgentName] = useState(() =>
    readDraftField((draft) => draft.agentName, ""),
  );
  const [agentKey, setAgentKey] = useState("");
  const [keyTouched] = useState(false);
  const [manifestText, setManifestText] = useState(() =>
    readDraftField(
      (draft) => draft.manifestText,
      manifestToText(defaultDeclarativeManifestTemplate()),
    ),
  );
  const [editorMode, setEditorMode] = useState<AgentStudioEditorMode>(() =>
    readDraftField((draft) => draft.editorMode, "guided"),
  );
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [errorStatus, setErrorStatus] = useState<number | undefined>();
  const [createdAgentId, setCreatedAgentId] = useState<string | undefined>();
  const [partialPublishFailure, setPartialPublishFailure] = useState(false);
  const [studioStage, setStudioStage] = useState<AgentStudioV2StageId>(() =>
    readDraftField((draft) => draft.stage, "describe"),
  );
  const [draftHydrated, setDraftHydrated] = useState(
    () => getSelectedWorkspaceId() !== undefined,
  );

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const workspaceId = authQuery.data?.workspaceId ?? "";

  useEffect(() => {
    if (draftHydrated || workspaceId.length === 0) {
      return;
    }
    const stored = readAgentStudioCreateDraft(workspaceId);
    if (stored !== undefined) {
      setAgentName(stored.agentName);
      setManifestText(stored.manifestText);
      setEditorMode(stored.editorMode);
      setStudioStage(stored.stage);
    }
    setDraftHydrated(true);
  }, [draftHydrated, workspaceId]);

  useEffect(() => {
    if (!draftHydrated || workspaceId.length === 0) {
      return;
    }
    const hasDraftContent =
      agentName.trim().length > 0 ||
      studioStage !== "describe" ||
      editorMode === "advanced";
    if (!hasDraftContent) {
      return;
    }
    writeAgentStudioCreateDraft(workspaceId, {
      agentName,
      manifestText,
      editorMode,
      stage: studioStage === "test" ? "review" : studioStage,
    });
  }, [
    agentName,
    draftHydrated,
    editorMode,
    manifestText,
    studioStage,
    workspaceId,
  ]);

  useEffect(() => {
    if (keyTouched) {
      return;
    }
    const slug = slugAgentKeyFromName(agentName);
    setAgentKey(slug);
    setManifestText((current) => {
      const parsed = parseManifestRecord(current);
      if (!parsed.ok) {
        return current;
      }
      return manifestToText({
        ...parsed.value,
        key: slug,
        name: agentName.trim() || String(parsed.value.name),
      });
    });
  }, [agentName, keyTouched]);

  const parsedManifest = parseManifestRecord(manifestText);
  const validation = parsedManifest.ok
    ? describeDeclarativeManifestValidation(parsedManifest.value)
    : {
        ok: false,
        messages: [parsedManifest.message],
        fieldErrors: {},
      };

  const canSubmit =
    canWrite &&
    agentName.trim().length > 0 &&
    agentKey.trim().length > 0 &&
    parsedManifest.ok &&
    validation.ok &&
    !createAgent.isPending &&
    !createVersion.isPending &&
    !submittingRef.current;

  if (authQuery.isLoading || !draftHydrated) {
    return <LoadingBlock label="Loading…" />;
  }

  if (authQuery.isError) {
    return <ErrorState title="Authentication failed" error={authQuery.error} />;
  }

  async function publishAgent() {
    if (!canSubmit || submittingRef.current || !parsedManifest.ok) {
      return;
    }
    submittingRef.current = true;
    setFeedback(undefined);
    setErrorRequestId(undefined);
    setErrorStatus(undefined);
    setPartialPublishFailure(false);
    let agentIdForAttempt = createdAgentId;
    try {
      if (agentIdForAttempt === undefined) {
        const createdAgent = await createAgent.mutateAsync({
          key: agentKey.trim(),
          name: agentName.trim(),
        });
        agentIdForAttempt = createdAgent.id;
        setCreatedAgentId(createdAgent.id);
      }
      const manifest = {
        ...parsedManifest.value,
        key: agentKey.trim(),
        name: agentName.trim(),
      };
      const createdVersion = await createVersion.mutateAsync({
        agentId: agentIdForAttempt,
        manifest,
      });
      clearAgentStudioCreateDraft(workspaceId);
      navigate(
        `/agents/${agentIdForAttempt}/versions/${createdVersion.id}?published=1&studio=test`,
      );
    } catch (error) {
      submittingRef.current = false;
      if (agentIdForAttempt !== undefined) {
        setPartialPublishFailure(true);
      }
      setFeedback(
        error instanceof Error ? error.message : "Failed to create agent.",
      );
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
        setErrorStatus(error.status);
      }
    }
  }

  const workspaceName = authQuery.data?.workspaceId;

  return (
    <>
      <PageHeader
        title="Create Agent"
        subtitle="Describe what you want, equip a model, review, then test with a real Run."
        actions={
          <>
            <LinkButton variant="secondary" to="/agents">
              Back to agents
            </LinkButton>
            <LinkButton variant="secondary" to="/agents/new/developer">
              Developer registration
            </LinkButton>
          </>
        }
      />

      {!canWrite ? (
        <p className="muted">{describeControlPlaneWriteRoleRequirement()}</p>
      ) : null}

      <AgentStudioV2Workspace
        agentName={agentName}
        showAgentRegistrationFields
        onAgentNameChange={(name) => {
          setAgentName(name);
          setFeedback(undefined);
          setErrorStatus(undefined);
        }}
        manifestText={manifestText}
        onManifestTextChange={(next) => {
          setManifestText(next);
          setFeedback(undefined);
          setErrorStatus(undefined);
        }}
        canWrite={canWrite}
        disabled={createAgent.isPending || createVersion.isPending}
        workspaceName={workspaceName}
        editorMode={editorMode}
        onEditorModeChange={setEditorMode}
        validation={validation}
        publishLabel={
          partialPublishFailure ? "Retry publishing" : "Publish agent version"
        }
        onPublish={publishAgent}
        publishPending={createAgent.isPending || createVersion.isPending}
        partialPublishFailure={partialPublishFailure}
        createdAgentId={createdAgentId}
        feedback={feedback}
        errorRequestId={errorRequestId}
        errorStatus={errorStatus}
        initialTemplatesOpen={openTemplatesFromAgentsPage}
        initialStage={studioStage}
        onStageChange={setStudioStage}
        banner={
          partialPublishFailure && createdAgentId !== undefined ? (
            <section
              className="panel"
              data-testid="agent-studio-partial-publish"
            >
              <p>
                <strong>
                  Agent created, but publishing didn&apos;t finish.
                </strong>{" "}
                Fix the manifest if needed, then use{" "}
                <strong>Retry publishing</strong>. A duplicate Agent row will
                not be created.{" "}
                <Link className="mono" to={`/agents/${createdAgentId}`}>
                  {createdAgentId}
                </Link>
              </p>
            </section>
          ) : undefined
        }
      />
    </>
  );
}
