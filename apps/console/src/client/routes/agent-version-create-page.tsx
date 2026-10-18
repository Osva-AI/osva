import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import {
  useAgentQuery,
  useCreateAgentVersionMutation,
} from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  HELLO_AGENT_GOLDEN_PATH_COMMAND,
  HELLO_AGENT_SETUP_COMMANDS,
  HELLO_AGENT_SOURCE_PATH,
  helloAgentManifestJson,
} from "../lib/agent-example";
import {
  applyGuidedManifestFields,
  defaultGuidedManifestFields,
  describeBuiltinPackageWarning,
  describeManifestSubmitBlocker,
  describeRegistryWriteFailure,
  extractGuidedManifestFields,
  GUIDED_RUNTIME_TYPES,
  type GuidedManifestFields,
} from "../lib/agent-manifest-draft";
import { ConsoleApiError } from "../lib/console-api";
import { parseWorkflowRunInputJson } from "../lib/workflow-run-input";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { ModelProfileVersionSelector } from "../components/agent/model-profile-version-selector";

export function AgentVersionCreatePage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const agentQuery = useAgentQuery(agentId);
  const mutation = useCreateAgentVersionMutation();
  const submittingRef = useRef(false);
  const [manifestText, setManifestText] = useState(() =>
    helloAgentManifestJson(),
  );
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [errorStatus, setErrorStatus] = useState<number | undefined>();
  const [primaryModelVersionId, setPrimaryModelVersionId] = useState("");

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  useEffect(() => {
    const agent = agentQuery.data;
    if (agent === undefined) {
      return;
    }
    setManifestText((current) => {
      const parsedCurrent = parseWorkflowRunInputJson(current);
      if (!parsedCurrent.ok) {
        return current;
      }
      const fields = extractGuidedManifestFields(parsedCurrent.value);
      if (fields.key !== "hello-agent" || fields.name !== "Hello Agent") {
        return current;
      }
      return helloAgentManifestJson({
        key: agent.key,
        name: agent.name,
      });
    });
  }, [agentQuery.data]);

  const parsed = parseWorkflowRunInputJson(manifestText);
  const guided = parsed.ok
    ? extractGuidedManifestFields(parsed.value)
    : defaultGuidedManifestFields({
        key: agentQuery.data?.key,
        name: agentQuery.data?.name,
      });
  const submitBlocker = describeManifestSubmitBlocker(manifestText);
  const builtinWarning = describeBuiltinPackageWarning(manifestText);
  const canSubmit =
    canWrite &&
    parsed.ok &&
    submitBlocker === undefined &&
    !mutation.isPending &&
    !submittingRef.current;

  const notFound =
    agentQuery.isError &&
    agentQuery.error instanceof ConsoleApiError &&
    agentQuery.error.status === 404;

  if (agentId === undefined) {
    return (
      <ErrorState title="Invalid route" error={new Error("Missing agentId.")} />
    );
  }

  const resolvedAgentId = agentId;

  if (authQuery.isLoading || agentQuery.isLoading) {
    return <LoadingBlock label="Loading agent…" />;
  }

  if (notFound) {
    return (
      <EmptyState
        title="Agent not found."
        description="This agent is not visible in the authenticated workspace."
      />
    );
  }

  function patchGuided(patch: Partial<GuidedManifestFields>) {
    setManifestText(
      applyGuidedManifestFields(manifestText, { ...guided, ...patch }),
    );
    setFeedback(undefined);
    setErrorStatus(undefined);
  }

  function applyPrimaryModelBinding(modelProfileVersionId: string) {
    const parsedManifest = parseWorkflowRunInputJson(manifestText);
    if (!parsedManifest.ok) {
      return;
    }
    const record = { ...(parsedManifest.value as Record<string, unknown>) };
    record.models = {
      primary: { modelProfileVersionId },
    };
    setManifestText(JSON.stringify(record, null, 2));
    setPrimaryModelVersionId(modelProfileVersionId);
  }

  async function submit() {
    if (!parsed.ok || !canSubmit || submittingRef.current) {
      if (submitBlocker !== undefined) {
        setFeedback(submitBlocker);
      }
      return;
    }
    submittingRef.current = true;
    setFeedback(undefined);
    setErrorRequestId(undefined);
    setErrorStatus(undefined);
    try {
      const created = await mutation.mutateAsync({
        agentId: resolvedAgentId,
        manifest: parsed.value,
      });
      navigate(`/agents/${resolvedAgentId}/versions/${created.id}`);
    } catch (error) {
      submittingRef.current = false;
      setFeedback(
        error instanceof Error
          ? error.message
          : "Failed to create AgentVersion.",
      );
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
        setErrorStatus(error.status);
      }
    }
  }

  const guidance =
    errorStatus === undefined
      ? undefined
      : describeRegistryWriteFailure(errorStatus);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Create AgentVersion</h1>
          <p className="page-subtitle mono">{agentId}</p>
        </div>
        <Link className="button" to={`/agents/${resolvedAgentId}`}>
          Back to agent
        </Link>
      </header>

      {!canWrite ? (
        <p className="muted">
          Creating an AgentVersion requires an EDITOR or ADMIN role.
        </p>
      ) : null}

      <section className="panel">
        <p>
          Publishing appends a new immutable version. Previous versions are
          never rewritten. The guided fields and JSON editor share one Agent
          Manifest v1 document — they are not a second format.
        </p>
        <p className="muted">
          Hello Agent source:{" "}
          <span className="mono">{HELLO_AGENT_SOURCE_PATH}</span> — run{" "}
          <span className="mono">{HELLO_AGENT_GOLDEN_PATH_COMMAND}</span> to
          install trusted runtime bytes and compute integrity automatically.
        </p>
        <pre className="json-view">{HELLO_AGENT_SETUP_COMMANDS.join("\n")}</pre>

        <h2 className="panel-title">Guided fields</h2>
        <p className="muted">
          Required runtime fields come from the Agent Manifest v1 contract.
          TRUSTED_TYPESCRIPT needs a real sha256 digest before submit.
        </p>
        <div className="filters">
          <div className="field">
            <label htmlFor="agent-version-key">Manifest key</label>
            <input
              id="agent-version-key"
              value={guided.key}
              onChange={(event) => patchGuided({ key: event.target.value })}
              disabled={!canWrite || mutation.isPending}
            />
          </div>
          <div className="field">
            <label htmlFor="agent-version-name">Manifest name</label>
            <input
              id="agent-version-name"
              value={guided.name}
              onChange={(event) => patchGuided({ name: event.target.value })}
              disabled={!canWrite || mutation.isPending}
            />
          </div>
          <div className="field">
            <label htmlFor="agent-version-runtime-type">Runtime type</label>
            <select
              id="agent-version-runtime-type"
              value={guided.runtimeType}
              onChange={(event) =>
                patchGuided({
                  runtimeType: event.target
                    .value as GuidedManifestFields["runtimeType"],
                })
              }
              disabled={!canWrite || mutation.isPending}
            >
              {GUIDED_RUNTIME_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="agent-version-timeout">execution.timeoutMs</label>
            <input
              id="agent-version-timeout"
              value={guided.timeoutMs}
              onChange={(event) =>
                patchGuided({ timeoutMs: event.target.value })
              }
              disabled={!canWrite || mutation.isPending}
            />
          </div>
        </div>

        {guided.runtimeType === "TRUSTED_TYPESCRIPT" ? (
          <div className="filters">
            <div className="field">
              <label htmlFor="agent-version-entrypoint">
                runtime.entrypoint
              </label>
              <input
                id="agent-version-entrypoint"
                value={guided.entrypoint}
                onChange={(event) =>
                  patchGuided({ entrypoint: event.target.value })
                }
                disabled={!canWrite || mutation.isPending}
              />
            </div>
            <div className="field">
              <label htmlFor="agent-version-integrity">runtime.integrity</label>
              <input
                id="agent-version-integrity"
                value={guided.integrity}
                onChange={(event) =>
                  patchGuided({ integrity: event.target.value })
                }
                disabled={!canWrite || mutation.isPending}
                spellCheck={false}
              />
            </div>
          </div>
        ) : null}

        {guided.runtimeType === "REMOTE_HTTP" ? (
          <div className="field">
            <label htmlFor="agent-version-endpoint">runtime.endpoint</label>
            <input
              id="agent-version-endpoint"
              value={guided.remoteEndpoint}
              onChange={(event) =>
                patchGuided({ remoteEndpoint: event.target.value })
              }
              disabled={!canWrite || mutation.isPending}
            />
          </div>
        ) : null}

        {guided.runtimeType === "CONTAINER" ? (
          <div className="field">
            <label htmlFor="agent-version-image">runtime.image</label>
            <input
              id="agent-version-image"
              value={guided.containerImage}
              onChange={(event) =>
                patchGuided({ containerImage: event.target.value })
              }
              disabled={!canWrite || mutation.isPending}
            />
          </div>
        ) : null}

        <ModelProfileVersionSelector
          value={primaryModelVersionId}
          disabled={!canWrite || mutation.isPending}
          onChange={(selection) => {
            if (selection === undefined) {
              setPrimaryModelVersionId("");
              return;
            }
            applyPrimaryModelBinding(selection.modelProfileVersionId);
          }}
        />

        {guided.runtimeType === "BUILTIN_PACKAGE" ? (
          <div className="field">
            <label htmlFor="agent-version-package-key">runtime.key</label>
            <input
              id="agent-version-package-key"
              value={guided.packageKey}
              onChange={(event) =>
                patchGuided({ packageKey: event.target.value })
              }
              disabled={!canWrite || mutation.isPending}
            />
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="agent-version-manifest-json">Manifest (JSON)</label>
          <textarea
            id="agent-version-manifest-json"
            rows={18}
            value={manifestText}
            onChange={(event) => {
              setManifestText(event.target.value);
              setFeedback(undefined);
              setErrorStatus(undefined);
            }}
            spellCheck={false}
            disabled={!canWrite || mutation.isPending}
          />
        </div>
        {!parsed.ok ? (
          <p className="error-inline" role="alert">
            {parsed.message}
          </p>
        ) : submitBlocker !== undefined ? (
          <p className="error-inline" role="alert">
            {submitBlocker}
          </p>
        ) : (
          <p className="muted">
            JSON syntax is valid. The control plane still validates the
            AgentVersion manifest contract on submit.
          </p>
        )}
        {builtinWarning !== undefined ? (
          <p className="error-inline">{builtinWarning}</p>
        ) : null}
        <button
          type="button"
          className="button primary"
          onClick={() => void submit()}
          disabled={!canSubmit}
        >
          {mutation.isPending ? "Creating version…" : "Create AgentVersion"}
        </button>
        {guidance !== undefined ? (
          <p className="error-inline">{guidance}</p>
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
