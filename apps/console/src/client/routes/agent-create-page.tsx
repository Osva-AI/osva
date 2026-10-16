import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useCreateAgentMutation } from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { HELLO_AGENT_KEY, HELLO_AGENT_NAME } from "../lib/agent-example";
import { describeRegistryWriteFailure } from "../lib/agent-manifest-draft";
import { ConsoleApiError } from "../lib/console-api";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function AgentCreatePage() {
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const mutation = useCreateAgentMutation();
  const submittingRef = useRef(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [errorStatus, setErrorStatus] = useState<number | undefined>();

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  if (authQuery.isLoading) {
    return <LoadingBlock label="Loading…" />;
  }

  if (authQuery.isError) {
    return <ErrorState title="Authentication failed" error={authQuery.error} />;
  }

  const canSubmit =
    canWrite &&
    key.trim().length > 0 &&
    name.trim().length > 0 &&
    !mutation.isPending &&
    !submittingRef.current;

  async function submit() {
    if (!canSubmit || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setFeedback(undefined);
    setErrorRequestId(undefined);
    setErrorStatus(undefined);
    try {
      const created = await mutation.mutateAsync({
        key: key.trim(),
        name: name.trim(),
      });
      navigate(`/agents/${created.id}`);
    } catch (error) {
      submittingRef.current = false;
      setFeedback(
        error instanceof Error ? error.message : "Failed to register agent.",
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
          <h1 className="page-title">Register Agent</h1>
          <p className="page-subtitle">
            Creates a workspace Agent registry row. An AgentVersion with a
            runtime manifest is required before a Run can execute.
          </p>
        </div>
        <Link className="button" to="/agents">
          Back to agents
        </Link>
      </header>

      {!canWrite ? (
        <p className="muted">
          Registering an Agent requires an EDITOR or ADMIN role.
        </p>
      ) : null}

      <section className="panel">
        <div className="field">
          <label htmlFor="agent-key">Key</label>
          <input
            id="agent-key"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setFeedback(undefined);
              setErrorStatus(undefined);
            }}
            disabled={!canWrite || mutation.isPending}
            autoComplete="off"
          />
          <p className="muted">
            Workspace-unique identifier. Creating an Agent does not create a
            runnable version.
          </p>
        </div>
        <div className="field">
          <label htmlFor="agent-name">Name</label>
          <input
            id="agent-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setFeedback(undefined);
              setErrorStatus(undefined);
            }}
            disabled={!canWrite || mutation.isPending}
            autoComplete="off"
          />
          <p className="muted">Display name for the registry row.</p>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className="button"
            onClick={() => {
              setKey(HELLO_AGENT_KEY);
              setName(HELLO_AGENT_NAME);
              setFeedback(undefined);
              setErrorStatus(undefined);
            }}
            disabled={!canWrite || mutation.isPending}
          >
            Use Hello Agent example
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {mutation.isPending ? "Registering…" : "Register Agent"}
          </button>
        </div>
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
