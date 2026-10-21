import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { WorkspaceSetupPanel } from "../components/workspace/workspace-setup-panel";
import { useAuth } from "../context/auth-context";
import { useAgentsListQuery } from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useModelProfilesListQuery,
  useModelProviderConnectionsListQuery,
} from "../hooks/use-models";
import { useRunsListQuery } from "../hooks/use-runs";
import { useWorkflowRunsListQuery } from "../hooks/use-workflow-runs";
import { useWorkflowsListQuery } from "../hooks/use-workflows";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import { ConsoleApiError } from "../lib/console-api";
import { formatTimestamp } from "../lib/formatting";
import {
  attentionKindLabel,
  collectAttentionFromRecentRuns,
  collectAttentionFromRecentWorkflowRuns,
} from "../lib/overview-attention";
import {
  presentRecentList,
  presentRegistryCount,
} from "../lib/overview-counts";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";
import { runStatusCategory, workflowRunStatusCategory } from "../lib/statuses";

const RECENT_LIMIT = 8;

export function OverviewPage() {
  const auth = useAuth();
  const workspaceScope = useWorkspaceQueryScope();
  const workspace =
    auth.workspaces.find((item) => item.workspaceId === workspaceScope) ??
    auth.selectedWorkspace;
  const workspaceAligned = workspaceScope !== undefined;

  const authContextQuery = useAuthContextQuery();
  const role = authContextQuery.data?.role ?? workspace?.role ?? "—";
  const authContext = authContextQuery.data;
  const authContextAligned = authContext?.workspaceId === workspaceScope;
  const canWrite =
    authContextAligned &&
    authContext !== undefined &&
    roleCanWriteControlPlaneResources(authContext.role);
  const canExecute =
    authContextAligned &&
    authContext !== undefined &&
    roleCanExecuteControlPlaneActions(authContext.role);

  const agentsQuery = useAgentsListQuery();
  const workflowsQuery = useWorkflowsListQuery();
  const modelProfilesQuery = useModelProfilesListQuery();
  const modelConnectionsQuery = useModelProviderConnectionsListQuery();
  const recentRunsQuery = useRunsListQuery({ limit: RECENT_LIMIT });
  const recentWorkflowRunsQuery = useWorkflowRunsListQuery({
    limit: RECENT_LIMIT,
  });

  const agentCount = workspaceAligned
    ? agentsQuery.data?.agents.length
    : undefined;
  const workflowCount = workspaceAligned
    ? workflowsQuery.data?.workflows.length
    : undefined;

  const agentCountView = presentRegistryCount(agentCount, "Agents");
  const workflowCountView = presentRegistryCount(workflowCount, "Workflows");

  const recentRuns = workspaceAligned ? (recentRunsQuery.data?.runs ?? []) : [];
  const recentWorkflowRuns = workspaceAligned
    ? (recentWorkflowRunsQuery.data?.workflowRuns ?? [])
    : [];
  const runsPresentation = presentRecentList(
    recentRuns.length,
    RECENT_LIMIT,
    recentRunsQuery.data?.nextCursor,
    "Runs",
  );
  const workflowRunsPresentation = presentRecentList(
    recentWorkflowRuns.length,
    RECENT_LIMIT,
    recentWorkflowRunsQuery.data?.nextCursor,
    "Workflow runs",
  );

  const attentionItems = [
    ...collectAttentionFromRecentRuns(recentRuns),
    ...collectAttentionFromRecentWorkflowRuns(recentWorkflowRuns),
  ].slice(0, 10);

  const partialErrors: string[] = [];
  if (agentsQuery.isError) {
    partialErrors.push(describeQueryError(agentsQuery.error, "Agents"));
  }
  if (workflowsQuery.isError) {
    partialErrors.push(describeQueryError(workflowsQuery.error, "Workflows"));
  }
  if (recentRunsQuery.isError) {
    partialErrors.push(
      describeQueryError(recentRunsQuery.error, "Recent runs"),
    );
  }
  if (recentWorkflowRunsQuery.isError) {
    partialErrors.push(
      describeQueryError(recentWorkflowRunsQuery.error, "Recent workflow runs"),
    );
  }

  const loadingCore =
    !workspaceAligned ||
    authContextQuery.isLoading ||
    (agentsQuery.isLoading && agentsQuery.data === undefined);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">
            Workspace-scoped summary from existing Console APIs. Counts reflect
            loaded registry lists; run tables show recent pages only.
          </p>
        </div>
        <div className="action-row">
          {canWrite ? (
            <>
              <Link className="button" to="/agents/new">
                Create Agent
              </Link>
              <Link className="button button-secondary" to="/workflows/new">
                Build Workflow
              </Link>
            </>
          ) : null}
          <Link className="button button-secondary" to="/runs">
            View Runs
          </Link>
        </div>
      </header>

      {!workspaceAligned ? (
        <LoadingBlock label="Select a workspace to view Overview." />
      ) : null}

      {loadingCore ? <LoadingBlock label="Loading workspace summary…" /> : null}

      {authContextQuery.isError ? (
        <ErrorState
          title="Could not load role"
          error={authContextQuery.error}
        />
      ) : null}

      {partialErrors.length > 0 ? (
        <section className="panel panel-warning" aria-live="polite">
          <h2 className="panel-title">Partial data</h2>
          <ul className="plain-list">
            {partialErrors.map((message) => (
              <li key={message} className="muted">
                {message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {workspaceAligned && !loadingCore ? (
        <>
          <section className="panel">
            <h2 className="panel-title">Workspace</h2>
            <dl className="overview-meta-grid">
              <div>
                <dt>Name</dt>
                <dd>{workspace?.name ?? "—"}</dd>
              </div>
              <div>
                <dt>Workspace ID</dt>
                <dd className="mono">{workspace?.workspaceId ?? "—"}</dd>
              </div>
              <div>
                <dt>Your role</dt>
                <dd className="mono">{role}</dd>
              </div>
            </dl>
          </section>

          <section className="overview-metrics">
            <article className="metric-card">
              <h3 className="metric-label">{agentCountView.label}</h3>
              <p className="metric-value">
                {agentCountView.value === undefined
                  ? "—"
                  : agentCountView.value}
              </p>
              <p className="muted metric-detail">{agentCountView.detail}</p>
              <Link to="/agents">Open Agents</Link>
            </article>
            <article className="metric-card">
              <h3 className="metric-label">{workflowCountView.label}</h3>
              <p className="metric-value">
                {workflowCountView.value === undefined
                  ? "—"
                  : workflowCountView.value}
              </p>
              <p className="muted metric-detail">{workflowCountView.detail}</p>
              <Link to="/workflows">Open Workflows</Link>
            </article>
          </section>

          <section className="panel">
            <h2 className="panel-title">Primary actions</h2>
            <div className="action-grid">
              <ActionTile
                title="Create Agent"
                description="No-code Agent Studio for declarative agents."
                to="/agents/new"
                hidden={!canWrite}
              />
              <ActionTile
                title="Build Workflow"
                description="Compose agents, tools, and approvals."
                to="/workflows/new"
                hidden={!canWrite}
              />
              <ActionTile
                title="Configure Model"
                description="Provider connections and model profiles."
                to="/models"
                hidden={!canWrite}
              />
              <ActionTile
                title="Connect Tool"
                description="Registry tools and connector versions."
                to="/tools/connectors"
                hidden={!canWrite}
              />
              <ActionTile
                title="View Runs"
                description="Agent execution history for this workspace."
                to="/runs"
              />
              <ActionTile
                title="Getting started"
                description="Step-by-step first agent journey."
                to="/onboarding"
              />
            </div>
            {!canWrite && !canExecute ? (
              <p className="muted">
                Your role can view workspace data. Create and configure actions
                require DEVELOPER, ADMIN, or OWNER; run actions require
                OPERATOR, DEVELOPER, ADMIN, or OWNER.
              </p>
            ) : null}
          </section>

          <WorkspaceSetupPanel
            controlPlaneReachable={authContextQuery.data !== undefined}
            agents={agentsQuery.data?.agents}
            modelProfiles={modelProfilesQuery.data?.modelProfiles}
            modelConnections={modelConnectionsQuery.data?.connections}
          />

          <section className="panel">
            <div className="panel-header-row">
              <h2 className="panel-title">Needs attention</h2>
              <span className="muted">
                From the {String(RECENT_LIMIT)} most recent runs loaded—not a
                complete workspace audit.
              </span>
            </div>
            {attentionItems.length === 0 ? (
              <EmptyState
                title="Nothing flagged in recent runs"
                description="Failed, waiting, or in-progress items appear here when present in the latest loaded run pages."
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Signal</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionItems.map((item) => (
                    <tr key={`${item.kind}-${item.id}`}>
                      <td>{item.kind === "run" ? "Run" : "Workflow run"}</td>
                      <td className="mono">
                        <Link
                          to={
                            item.kind === "run"
                              ? `/runs/${encodeURIComponent(item.id)}`
                              : `/workflow-runs/${encodeURIComponent(item.id)}`
                          }
                        >
                          {item.id}
                        </Link>
                      </td>
                      <td>
                        <StatusChip
                          status={item.status}
                          category={
                            item.kind === "run"
                              ? runStatusCategory(item.status)
                              : workflowRunStatusCategory(item.status)
                          }
                        />
                      </td>
                      <td>{attentionKindLabel(item.attentionKind)}</td>
                      <td>{formatTimestamp(item.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="panel-header-row">
              <h2 className="panel-title">Recent agent Runs</h2>
              <span className="muted">
                Showing {runsPresentation.shown} of up to{" "}
                {runsPresentation.limit}
                {runsPresentation.hasMore ? " (more on Runs page)" : ""}
              </span>
            </div>
            {recentRunsQuery.isError ? (
              <ErrorState
                title="Runs unavailable"
                error={recentRunsQuery.error}
              />
            ) : recentRuns.length === 0 ? (
              <>
                <EmptyState
                  title="No runs yet"
                  description="Launch a Run from an AgentVersion after publishing."
                />
                {canExecute ? (
                  <Link className="button" to="/agents">
                    Open Agents
                  </Link>
                ) : null}
              </>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="mono">
                        <Link to={`/runs/${encodeURIComponent(run.id)}`}>
                          {run.id}
                        </Link>
                      </td>
                      <td className="mono">{run.agentId}</td>
                      <td>
                        <StatusChip
                          status={run.status}
                          category={runStatusCategory(run.status)}
                        />
                      </td>
                      <td>{formatTimestamp(run.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Link to="/runs">View all Runs</Link>
          </section>

          <section className="panel">
            <div className="panel-header-row">
              <h2 className="panel-title">Recent WorkflowRuns</h2>
              <span className="muted">
                Showing {workflowRunsPresentation.shown} of up to{" "}
                {workflowRunsPresentation.limit}
                {workflowRunsPresentation.hasMore
                  ? " (more on Workflow Runs page)"
                  : ""}
              </span>
            </div>
            {recentWorkflowRunsQuery.isError ? (
              <ErrorState
                title="Workflow runs unavailable"
                error={recentWorkflowRunsQuery.error}
              />
            ) : recentWorkflowRuns.length === 0 ? (
              <>
                <EmptyState
                  title="No workflow runs yet"
                  description="Publish a workflow version and launch a WorkflowRun."
                />
                {canWrite ? (
                  <Link className="button" to="/workflows">
                    Open Workflows
                  </Link>
                ) : null}
              </>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Workflow run</th>
                    <th>Workflow</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recentWorkflowRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="mono">
                        <Link
                          to={`/workflow-runs/${encodeURIComponent(run.id)}`}
                        >
                          {run.id}
                        </Link>
                      </td>
                      <td className="mono">{run.workflowId}</td>
                      <td>
                        <StatusChip
                          status={run.status}
                          category={workflowRunStatusCategory(run.status)}
                        />
                      </td>
                      <td>{formatTimestamp(run.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Link to="/workflow-runs">View all Workflow Runs</Link>
          </section>
        </>
      ) : null}
    </>
  );
}

function ActionTile({
  title,
  description,
  to,
  hidden,
}: {
  readonly title: string;
  readonly description: string;
  readonly to: string;
  readonly hidden?: boolean;
}) {
  if (hidden) {
    return null;
  }
  return (
    <Link className="action-tile" to={to}>
      <strong>{title}</strong>
      <span className="muted">{description}</span>
    </Link>
  );
}

function describeQueryError(error: unknown, label: string): string {
  if (error instanceof ConsoleApiError) {
    if (error.status === 403) {
      return `${label}: permission denied for your role.`;
    }
    return `${label}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `${label}: ${error.message}`;
  }
  return `${label}: request failed.`;
}
