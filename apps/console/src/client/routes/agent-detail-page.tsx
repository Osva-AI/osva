import { Link, useParams } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAgentQuery, useAgentVersionsQuery } from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { readAgentRuntimeView } from "../lib/agent-manifest-view";
import { onboardingSearch } from "../lib/agent-onboarding";
import { ConsoleApiError } from "../lib/console-api";
import { formatTimestamp } from "../lib/formatting";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const agentQuery = useAgentQuery(agentId);
  const versionsQuery = useAgentVersionsQuery(agentId);
  const authQuery = useAuthContextQuery();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  const notFound =
    agentQuery.isError &&
    agentQuery.error instanceof ConsoleApiError &&
    agentQuery.error.status === 404;

  if (agentId === undefined) {
    return (
      <ErrorState title="Invalid route" error={new Error("Missing agentId.")} />
    );
  }

  const versions = versionsQuery.data?.versions ?? [];
  const latestVersion =
    versions.length === 0
      ? undefined
      : versions.reduce(
          (latest, item) => (item.version > latest.version ? item : latest),
          versions[0]!,
        );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Agent</h1>
          <p className="page-subtitle mono">{agentId}</p>
        </div>
        <div className="toolbar">
          <Link
            className="button"
            to={`/onboarding${onboardingSearch({ agentId })}`}
          >
            Continue onboarding
          </Link>
          <Link className="button" to="/agents">
            All agents
          </Link>
        </div>
      </header>

      {agentQuery.isLoading ? <LoadingBlock label="Loading agent…" /> : null}
      {notFound ? (
        <EmptyState
          title="Agent not found."
          description="This agent is not visible in the authenticated workspace."
        />
      ) : null}
      {agentQuery.isError && !notFound ? (
        <ErrorState title="Failed to load agent" error={agentQuery.error} />
      ) : null}

      {agentQuery.data !== undefined ? (
        <section className="panel">
          <dl className="meta-grid">
            <div>
              <dt>Name</dt>
              <dd>{agentQuery.data.name}</dd>
            </div>
            <div>
              <dt>Key</dt>
              <dd className="mono">{agentQuery.data.key}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd className="mono">{agentQuery.data.workspaceId}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatTimestamp(agentQuery.data.createdAt)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="panel">
        <div className="page-header">
          <h2 className="panel-title">AgentVersions</h2>
          {canWrite ? (
            <Link
              className="button primary"
              to={`/agents/${agentId}/versions/new`}
            >
              New version
            </Link>
          ) : null}
          {canWrite ? (
            <Link
              className="button"
              to={`/agents/${agentId}/versions/new?from=${latestVersion?.id ?? ""}`}
              aria-disabled={versions.length === 0}
              onClick={(event) => {
                if (versions.length === 0) {
                  event.preventDefault();
                }
              }}
            >
              Copy latest version
            </Link>
          ) : null}
        </div>
        <p className="muted">
          Each AgentVersion is immutable. Creating a version never rewrites
          previous manifests. Run Agent uses the version you open — the Console
          does not substitute latest.
        </p>
        {!canExecute ? (
          <p className="muted">
            Launching a Run requires an OPERATOR, EDITOR, or ADMIN role.
          </p>
        ) : null}
        {versionsQuery.isLoading ? (
          <LoadingBlock label="Loading versions…" />
        ) : null}
        {versionsQuery.isError ? (
          <ErrorState
            title="Failed to load versions"
            error={versionsQuery.error}
          />
        ) : null}
        {versionsQuery.data !== undefined && versions.length === 0 ? (
          <EmptyState
            title="No versions yet."
            description="Append an immutable AgentVersion before launching a Run."
          />
        ) : null}
        {versions.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>AgentVersion ID</th>
                  <th>Runtime</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => {
                  const runtime = readAgentRuntimeView(version.manifest);
                  return (
                    <tr key={version.id}>
                      <td>v{version.version}</td>
                      <td>
                        <Link
                          className="mono"
                          to={`/agents/${agentId}/versions/${version.id}`}
                        >
                          {version.id}
                        </Link>
                      </td>
                      <td className="mono">{runtime.type}</td>
                      <td>{formatTimestamp(version.createdAt)}</td>
                      <td>
                        {canExecute ? (
                          <Link
                            className="button"
                            to={`/agents/${agentId}/versions/${version.id}`}
                          >
                            Run Agent
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
