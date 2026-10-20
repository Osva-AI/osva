import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import {
  AgentVersionReviewPanel,
  DeclarativeAgentStudioEditor,
  type AgentStudioEditorMode,
} from "../components/agent/declarative-agent-studio-editor";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { ModelProfileVersionSelector } from "../components/agent/model-profile-version-selector";
import { ToolVersionBindingSelector } from "../components/agent/tool-version-binding-selector";
import {
  useAgentQuery,
  useAgentVersionQuery,
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
import {
  cloneManifestForNewVersion,
  defaultDeclarativeManifestTemplate,
  describeDeclarativeManifestValidation,
  isDeclarativeManifest,
  manifestToText,
  parseManifestRecord,
  readPrimaryModelProfileVersionId,
} from "../lib/declarative-agent-manifest";
import { ConsoleApiError } from "../lib/console-api";
import { parseWorkflowRunInputJson } from "../lib/workflow-run-input";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

type AuthoringSurface = "studio" | "developer";

export function AgentVersionCreatePage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const agentQuery = useAgentQuery(agentId);
  const copyFromVersionId = searchParams.get("from") ?? undefined;
  const sourceVersionQuery = useAgentVersionQuery(agentId, copyFromVersionId);
  const mutation = useCreateAgentVersionMutation();
  const submittingRef = useRef(false);

  const initialSurface: AuthoringSurface =
    searchParams.get("developer") === "1" ? "developer" : "studio";

  const [surface, setSurface] = useState<AuthoringSurface>(initialSurface);
  const [editorMode, setEditorMode] = useState<AgentStudioEditorMode>("guided");
  const [showReview, setShowReview] = useState(false);
  const [manifestText, setManifestText] = useState("");
  const [manifestInitialized, setManifestInitialized] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [errorStatus, setErrorStatus] = useState<number | undefined>();
  const [primaryModelVersionId, setPrimaryModelVersionId] = useState("");

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  useEffect(() => {
    const agent = agentQuery.data;
    if (agent === undefined || manifestInitialized) {
      return;
    }
    const sourceManifest = sourceVersionQuery.data?.manifest;
    if (copyFromVersionId !== undefined && sourceVersionQuery.isLoading) {
      return;
    }
    const base =
      sourceManifest !== undefined
        ? cloneManifestForNewVersion(sourceManifest, {
            key: agent.key,
            name: agent.name,
          })
        : defaultDeclarativeManifestTemplate({
            key: agent.key,
            name: agent.name,
          });
    setManifestText(manifestToText(base));
    setPrimaryModelVersionId(readPrimaryModelProfileVersionId(base) ?? "");
    setManifestInitialized(true);
  }, [
    agentQuery.data,
    copyFromVersionId,
    manifestInitialized,
    sourceVersionQuery.data?.manifest,
    sourceVersionQuery.isLoading,
  ]);

  const parsed = parseManifestRecord(manifestText);
  const declarativeValidation =
    parsed.ok && isDeclarativeManifest(parsed.value)
      ? describeDeclarativeManifestValidation(parsed.value)
      : undefined;

  const guided = parsed.ok
    ? extractGuidedManifestFields(parsed.value)
    : defaultGuidedManifestFields({
        key: agentQuery.data?.key,
        name: agentQuery.data?.name,
      });

  const developerSubmitBlocker =
    surface === "developer"
      ? describeManifestSubmitBlocker(manifestText)
      : undefined;
  const builtinWarning = describeBuiltinPackageWarning(manifestText);

  const canSubmitStudio =
    canWrite &&
    parsed.ok &&
    declarativeValidation?.ok === true &&
    !mutation.isPending &&
    !submittingRef.current;

  const canSubmitDeveloper =
    canWrite &&
    parsed.ok &&
    developerSubmitBlocker === undefined &&
    !mutation.isPending &&
    !submittingRef.current;

  const canSubmit = surface === "studio" ? canSubmitStudio : canSubmitDeveloper;

  const notFound =
    agentQuery.isError &&
    agentQuery.error instanceof ConsoleApiError &&
    agentQuery.error.status === 404;

  const pageTitle = useMemo(
    () =>
      copyFromVersionId !== undefined
        ? "New version from existing"
        : "Create AgentVersion",
    [copyFromVersionId],
  );

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
    const capabilities = record.capabilities;
    record.capabilities =
      typeof capabilities === "object" && capabilities !== null
        ? { ...capabilities, model: true }
        : { model: true, tools: [] };
    setManifestText(JSON.stringify(record, null, 2));
    setPrimaryModelVersionId(modelProfileVersionId);
  }

  async function submit() {
    if (!parsed.ok || !canSubmit || submittingRef.current) {
      if (surface === "studio" && declarativeValidation?.ok === false) {
        setFeedback("Fix validation issues before publishing.");
        setShowReview(true);
      } else if (developerSubmitBlocker !== undefined) {
        setFeedback(developerSubmitBlocker);
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
      navigate(`/agents/${resolvedAgentId}/versions/${created.id}?published=1`);
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
          <h1 className="page-title">{pageTitle}</h1>
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
        <div className="toolbar">
          <button
            type="button"
            className={`button${surface === "studio" ? " primary" : ""}`}
            disabled={!canWrite}
            onClick={() => setSurface("studio")}
          >
            No-code studio
          </button>
          <button
            type="button"
            className={`button${surface === "developer" ? " primary" : ""}`}
            disabled={!canWrite}
            onClick={() => setSurface("developer")}
          >
            Developer runtime
          </button>
        </div>
        <p className="muted">
          Publishing appends a new immutable version. Test Runs execute only
          against a saved version — validating a draft does not invoke a model.
        </p>

        {surface === "studio" ? (
          <>
            {copyFromVersionId !== undefined ? (
              <p className="muted">
                Copied configuration from version{" "}
                <span className="mono">{copyFromVersionId}</span>. The original
                version is unchanged.
              </p>
            ) : null}
            {!manifestInitialized ? (
              <LoadingBlock label="Preparing draft…" />
            ) : (
              <>
                <DeclarativeAgentStudioEditor
                  manifestText={manifestText}
                  disabled={!canWrite || mutation.isPending}
                  mode={editorMode}
                  onModeChange={setEditorMode}
                  showManifestKeyFields
                  onManifestTextChange={(next) => {
                    setManifestText(next);
                    setFeedback(undefined);
                    setErrorStatus(undefined);
                    const parsedNext = parseManifestRecord(next);
                    if (parsedNext.ok) {
                      setPrimaryModelVersionId(
                        readPrimaryModelProfileVersionId(parsedNext.value) ??
                          "",
                      );
                    }
                  }}
                  validation={declarativeValidation}
                />
                <div className="toolbar">
                  <button
                    type="button"
                    className="button"
                    disabled={!parsed.ok}
                    onClick={() => setShowReview((current) => !current)}
                  >
                    {showReview ? "Hide review" : "Validate and review"}
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={!canSubmit}
                    onClick={() => void submit()}
                  >
                    {mutation.isPending
                      ? "Publishing…"
                      : "Publish AgentVersion"}
                  </button>
                </div>
                {showReview ? (
                  <AgentVersionReviewPanel manifestText={manifestText} />
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            <p className="muted">
              Hello Agent source:{" "}
              <span className="mono">{HELLO_AGENT_SOURCE_PATH}</span> — run{" "}
              <span className="mono">{HELLO_AGENT_GOLDEN_PATH_COMMAND}</span> to
              install trusted runtime bytes and compute integrity automatically.
            </p>
            <pre className="json-view">
              {HELLO_AGENT_SETUP_COMMANDS.join("\n")}
            </pre>
            <button
              type="button"
              className="button"
              disabled={!canWrite || mutation.isPending}
              onClick={() => {
                setManifestText(
                  helloAgentManifestJson({
                    key: agentQuery.data?.key,
                    name: agentQuery.data?.name,
                  }),
                );
              }}
            >
              Load Hello Agent manifest
            </button>

            <h2 className="panel-title">Guided fields</h2>
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
                  onChange={(event) =>
                    patchGuided({ name: event.target.value })
                  }
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
                <label htmlFor="agent-version-timeout">
                  execution.timeoutMs
                </label>
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
                  <label htmlFor="agent-version-integrity">
                    runtime.integrity
                  </label>
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

            <ToolVersionBindingSelector
              manifestText={manifestText}
              disabled={!canWrite || mutation.isPending}
              onManifestChange={(next) => {
                setManifestText(next);
                setFeedback(undefined);
                setErrorStatus(undefined);
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
              <label htmlFor="agent-version-manifest-json">
                Manifest (JSON)
              </label>
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
            ) : developerSubmitBlocker !== undefined ? (
              <p className="error-inline" role="alert">
                {developerSubmitBlocker}
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
          </>
        )}

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
