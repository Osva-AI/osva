import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { AgentPlaygroundPanel } from "../components/agent/agent-playground-panel";
import { AgentRunLaunchForm } from "../components/agent/agent-run-launch-form";
import { RuntimeReadinessPanel } from "../components/agent/runtime-readiness-panel";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { JsonView } from "../components/json-view/json-view";
import { LoadingBlock } from "../components/loading/loading-block";
import {
  useAgentQuery,
  useAgentVersionQuery,
  useAgentVersionsQuery,
} from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  readAgentRuntimeView,
  readDeclarativeConfigurationSummary,
  readManifestBindingNames,
  readManifestCapabilities,
  readManifestIoSchemas,
} from "../lib/agent-manifest-view";
import { onboardingSearch } from "../lib/agent-onboarding";
import { builderHandoffSearch } from "../lib/builder-handoff";
import { ConsoleApiError } from "../lib/console-api";
import { formatTimestamp } from "../lib/formatting";
import { roleCanExecuteControlPlaneActions } from "../lib/permissions";

export function AgentVersionPage() {
  const { agentId, agentVersionId } = useParams<{
    agentId: string;
    agentVersionId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const justPublished = searchParams.get("published") === "1";
  const agentQuery = useAgentQuery(agentId);
  const versionQuery = useAgentVersionQuery(agentId, agentVersionId);
  const versionsQuery = useAgentVersionsQuery(agentId);
  const authQuery = useAuthContextQuery();
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  const notFound =
    versionQuery.isError &&
    versionQuery.error instanceof ConsoleApiError &&
    versionQuery.error.status === 404;

  if (agentId === undefined || agentVersionId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing route parameters.")}
      />
    );
  }

  const version = versionQuery.data;
  const runtime = readAgentRuntimeView(version?.manifest);
  const capabilities = readManifestCapabilities(version?.manifest);
  const io = readManifestIoSchemas(version?.manifest);
  const bindings = readManifestBindingNames(version?.manifest);
  const declarativeSummary = readDeclarativeConfigurationSummary(
    version?.manifest,
  );
  const versions = versionsQuery.data?.versions ?? [];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">AgentVersion</h1>
          <p className="page-subtitle mono">{agentVersionId}</p>
        </div>
        <div className="toolbar">
          <Link
            className="button"
            to={`/onboarding${onboardingSearch({ agentId, agentVersionId })}`}
          >
            Continue onboarding
          </Link>
          <Link
            className="button"
            to={`/workflows/new${builderHandoffSearch({ agentId, agentVersionId })}`}
          >
            Use in Workflow Builder
          </Link>
          {canExecute ? (
            <a className="button primary" href="#run-agent">
              Test this version
            </a>
          ) : null}
          <Link className="button" to={`/agents/${agentId}`}>
            Back to agent
          </Link>
        </div>
      </header>

      {versionQuery.isLoading ? (
        <LoadingBlock label="Loading AgentVersion…" />
      ) : null}
      {notFound ? (
        <EmptyState
          title="AgentVersion not found."
          description="This version is not visible for the agent in your workspace."
        />
      ) : null}
      {versionQuery.isError && !notFound ? (
        <ErrorState
          title="Failed to load AgentVersion"
          error={versionQuery.error}
        />
      ) : null}

      {version !== undefined ? (
        <>
          {justPublished ? (
            <section className="panel">
              <p className="muted">
                This AgentVersion is now saved. Test runs use this immutable
                configuration and may invoke your model provider.
              </p>
            </section>
          ) : null}
          <section className="panel">
            <dl className="meta-grid">
              <div>
                <dt>Agent</dt>
                <dd>
                  {agentQuery.data?.name ?? (
                    <span className="mono">{agentId}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Agent ID</dt>
                <dd className="mono">{version.agentId}</dd>
              </div>
              <div>
                <dt>Version number</dt>
                <dd>v{version.version}</dd>
              </div>
              <div>
                <dt>AgentVersion ID</dt>
                <dd className="mono">{version.id}</dd>
              </div>
              <div>
                <dt>Runtime type</dt>
                <dd className="mono">{runtime.type}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatTimestamp(version.createdAt)}</dd>
              </div>
            </dl>
            {versions.length > 1 ? (
              <div className="field">
                <label htmlFor="agent-version-select">
                  Selected AgentVersion
                </label>
                <select
                  id="agent-version-select"
                  value={version.id}
                  onChange={(event) => {
                    navigate(
                      `/agents/${agentId}/versions/${event.target.value}`,
                    );
                  }}
                >
                  {versions.map((item) => (
                    <option key={item.id} value={item.id}>
                      v{item.version} — {item.id}
                    </option>
                  ))}
                </select>
                <p className="muted">
                  Changing this control navigates to the chosen immutable
                  version. The Console never silently substitutes another
                  version.
                </p>
              </div>
            ) : (
              <p className="muted">
                Selected AgentVersion is{" "}
                <span className="mono">{version.id}</span>.
              </p>
            )}
          </section>

          <section className="panel">
            <h2 className="panel-title">Runtime configuration</h2>
            {declarativeSummary !== undefined ? (
              <>
                <p className="muted">{runtime.summary}</p>
                <dl className="meta-grid">
                  <div>
                    <dt>Instructions</dt>
                    <dd>{declarativeSummary.instructionsPreview}</dd>
                  </div>
                  <div>
                    <dt>Model binding</dt>
                    <dd className="mono">{declarativeSummary.modelBinding}</dd>
                  </div>
                  <div>
                    <dt>Approved tools</dt>
                    <dd>
                      {declarativeSummary.allowedTools.length === 0
                        ? "None"
                        : declarativeSummary.allowedTools.join(", ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Model call budget</dt>
                    <dd>{declarativeSummary.maxModelInvocations}</dd>
                  </div>
                  <div>
                    <dt>Tool call budget</dt>
                    <dd>{declarativeSummary.maxToolInvocations}</dd>
                  </div>
                  <div>
                    <dt>Max output tokens</dt>
                    <dd>{declarativeSummary.maxOutputTokens}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="muted">{runtime.summary}</p>
            )}
            {Object.keys(runtime.details).length > 0 ? (
              <dl className="meta-grid">
                {Object.entries(runtime.details).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd className="mono">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="muted">
              Model capability:{" "}
              {capabilities.model ? "declared" : "not declared"}. Tools:{" "}
              {capabilities.tools.length === 0
                ? "none declared"
                : capabilities.tools.join(", ")}
              .
            </p>
            <p className="muted">
              Bindings — models: {formatBindingNames(bindings.models)}; tools:{" "}
              {formatBindingNames(bindings.tools)}; memory:{" "}
              {formatBindingNames(bindings.memory)}; knowledge:{" "}
              {formatBindingNames(bindings.knowledge)}.
            </p>
          </section>

          <section className="panel">
            <h2 className="panel-title">Input and output contracts</h2>
            <p className="muted">
              These schemas are copied from the persisted manifest. They are
              documentation for operators, not a Console execution validator.
            </p>
            {io.input !== undefined ? (
              <JsonView label="Input schema" value={io.input} />
            ) : (
              <p className="muted">
                No input schema is present on this manifest.
              </p>
            )}
            {io.output !== undefined ? (
              <JsonView label="Output schema" value={io.output} />
            ) : (
              <p className="muted">
                No output schema is present on this manifest.
              </p>
            )}
          </section>

          <RuntimeReadinessPanel
            controlPlaneReachable={authQuery.data !== undefined}
            selectedVersion={version}
          />

          <section className="panel">
            <h2 className="panel-title">Manifest</h2>
            <p className="muted">
              This payload is the persisted immutable AgentVersion manifest.
            </p>
            <JsonView label="Manifest" value={version.manifest ?? {}} />
          </section>

          <AgentPlaygroundPanel
            mode="embedded"
            agentId={agentId}
            agentVersionId={agentVersionId}
            agentName={agentQuery.data?.name}
            agentKey={agentQuery.data?.key}
            canExecute={canExecute}
          />

          <div id="run-agent">
            <AgentRunLaunchForm
              agentId={agentId}
              agentKey={agentQuery.data?.key}
              agentName={agentQuery.data?.name}
              selectedVersion={version}
              canExecute={canExecute}
              versionLoading={versionQuery.isLoading}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

function formatBindingNames(names: readonly string[]): string {
  return names.length === 0 ? "none" : names.join(", ");
}
