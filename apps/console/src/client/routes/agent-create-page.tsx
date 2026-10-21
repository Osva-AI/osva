import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  AgentVersionReviewPanel,
  DeclarativeAgentStudioEditor,
  type AgentStudioEditorMode,
} from "../components/agent/declarative-agent-studio-editor";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import {
  useCreateAgentMutation,
  useCreateAgentVersionMutation,
} from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { describeRegistryWriteFailure } from "../lib/agent-manifest-draft";
import {
  defaultDeclarativeManifestTemplate,
  describeDeclarativeManifestValidation,
  manifestToText,
  parseManifestRecord,
  slugAgentKeyFromName,
} from "../lib/declarative-agent-manifest";
import { ConsoleApiError } from "../lib/console-api";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function AgentCreatePage() {
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const createAgent = useCreateAgentMutation();
  const createVersion = useCreateAgentVersionMutation();
  const submittingRef = useRef(false);

  const [agentName, setAgentName] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [manifestText, setManifestText] = useState(() =>
    manifestToText(defaultDeclarativeManifestTemplate()),
  );
  const [editorMode, setEditorMode] = useState<AgentStudioEditorMode>("guided");
  const [showReview, setShowReview] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [errorStatus, setErrorStatus] = useState<number | undefined>();

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

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

  if (authQuery.isLoading) {
    return <LoadingBlock label="Loading…" />;
  }

  if (authQuery.isError) {
    return <ErrorState title="Authentication failed" error={authQuery.error} />;
  }

  async function publishAgent() {
    if (!canSubmit || submittingRef.current || !parsedManifest.ok) {
      if (!validation.ok) {
        setFeedback("Fix validation issues before publishing.");
        setShowReview(true);
      }
      return;
    }
    submittingRef.current = true;
    setFeedback(undefined);
    setErrorRequestId(undefined);
    setErrorStatus(undefined);
    try {
      const createdAgent = await createAgent.mutateAsync({
        key: agentKey.trim(),
        name: agentName.trim(),
      });
      const manifest = {
        ...parsedManifest.value,
        key: agentKey.trim(),
        name: agentName.trim(),
      };
      const createdVersion = await createVersion.mutateAsync({
        agentId: createdAgent.id,
        manifest,
      });
      navigate(
        `/agents/${createdAgent.id}/versions/${createdVersion.id}?published=1`,
      );
    } catch (error) {
      submittingRef.current = false;
      setFeedback(
        error instanceof Error ? error.message : "Failed to create agent.",
      );
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
        setErrorStatus(error.status);
      }
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Create Agent</h1>
          <p className="page-subtitle">
            Build a no-code declarative agent with instructions, an approved
            model, and optional tools. Publishing saves an immutable
            AgentVersion you can test with a Run.
          </p>
        </div>
        <div className="toolbar">
          <Link className="button" to="/agents">
            Back to agents
          </Link>
          <Link className="button" to="/agents/new/developer">
            Developer registration
          </Link>
        </div>
      </header>

      {!canWrite ? (
        <p className="muted">
          Creating an agent requires an EDITOR or ADMIN role.
        </p>
      ) : null}

      <section className="panel">
        <div className="filters">
          <div className="field">
            <label htmlFor="create-agent-name">Agent name</label>
            <input
              id="create-agent-name"
              value={agentName}
              onChange={(event) => {
                setAgentName(event.target.value);
                setFeedback(undefined);
                setErrorStatus(undefined);
              }}
              disabled={!canWrite || createAgent.isPending}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="create-agent-key">Agent key</label>
            <input
              id="create-agent-key"
              value={agentKey}
              onChange={(event) => {
                setKeyTouched(true);
                setAgentKey(event.target.value);
                setFeedback(undefined);
                setErrorStatus(undefined);
              }}
              disabled={!canWrite || createAgent.isPending}
              autoComplete="off"
            />
            <p className="muted">
              Generated from the name; edit if you need a specific key.
            </p>
          </div>
        </div>

        <DeclarativeAgentStudioEditor
          manifestText={manifestText}
          disabled={
            !canWrite || createAgent.isPending || createVersion.isPending
          }
          mode={editorMode}
          onModeChange={setEditorMode}
          onManifestTextChange={(next) => {
            setManifestText(next);
            setFeedback(undefined);
            setErrorStatus(undefined);
          }}
          validation={validation}
        />

        <div className="toolbar">
          <button
            type="button"
            className="button"
            disabled={!parsedManifest.ok}
            onClick={() => setShowReview((current) => !current)}
          >
            {showReview ? "Hide review" : "Validate and review"}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!canSubmit}
            onClick={() => void publishAgent()}
          >
            {createAgent.isPending || createVersion.isPending
              ? "Publishing…"
              : "Publish agent version"}
          </button>
        </div>

        {showReview ? (
          <AgentVersionReviewPanel manifestText={manifestText} />
        ) : null}

        {errorStatus !== undefined ? (
          <p className="error-inline">
            {describeRegistryWriteFailure(errorStatus)}
          </p>
        ) : null}
        {feedback !== undefined ? (
          <p className="error-inline">{feedback}</p>
        ) : null}
        {errorRequestId !== undefined ? (
          <p className="muted">
            Request ID: <span className="mono">{errorRequestId}</span>
          </p>
        ) : null}
      </section>
    </>
  );
}
