import { useMemo } from "react";
import { Link } from "react-router-dom";

import { OfficeSectionNav } from "../components/office/office-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { Button, LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAgentsListQuery } from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  recentAssignments,
  summarizeAssignmentCounts,
  useAllTeamMembershipsQuery,
  useOfficeAssignmentsQuery,
  useOfficeTeamsQuery,
  useOfficeWorkersQuery,
  type OfficeWorkerResource,
} from "../hooks/use-office";
import { assignmentStatusCategory } from "../lib/office-presentation";
import { formatTimestamp } from "../lib/formatting";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

function workerMembershipTeamIds(
  workerId: string,
  membershipQueries: ReturnType<typeof useAllTeamMembershipsQuery>,
  teams: readonly { readonly id: string }[],
): readonly string[] {
  const teamIds: string[] = [];
  for (let index = 0; index < membershipQueries.length; index += 1) {
    const query = membershipQueries[index];
    if (query === undefined) {
      continue;
    }
    const teamId = teams[index]?.id;
    if (teamId === undefined || query.data === undefined) {
      continue;
    }
    for (const membership of query.data.items) {
      if (membership.officeWorkerId === workerId) {
        teamIds.push(teamId);
      }
    }
  }
  return teamIds;
}

export function OfficeMissionControlPage() {
  const authQuery = useAuthContextQuery();
  const workersQuery = useOfficeWorkersQuery();
  const teamsQuery = useOfficeTeamsQuery();
  const assignmentsQuery = useOfficeAssignmentsQuery();
  const agentsQuery = useAgentsListQuery();

  const teamIds = teamsQuery.data?.items.map((team) => team.id);
  const membershipQueries = useAllTeamMembershipsQuery(teamIds);

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const workers = workersQuery.data?.items ?? [];
  const teams = teamsQuery.data?.items ?? [];
  const assignments = assignmentsQuery.data?.items ?? [];

  const counts = useMemo(() => {
    const assignmentCounts = summarizeAssignmentCounts(assignments);
    return {
      workers: workers.length,
      teams: teams.length,
      ...assignmentCounts,
    };
  }, [assignments, teams.length, workers.length]);

  const workerById = useMemo(() => {
    const map = new Map<string, OfficeWorkerResource>();
    for (const worker of workers) {
      map.set(worker.id, worker);
    }
    return map;
  }, [workers]);

  const teamMemberCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (let index = 0; index < membershipQueries.length; index += 1) {
      const query = membershipQueries[index];
      if (query === undefined) {
        continue;
      }
      const teamId = teams[index]?.id;
      if (teamId === undefined || query.data === undefined) {
        continue;
      }
      map.set(teamId, query.data.items.length);
    }
    return map;
  }, [membershipQueries, teams]);

  const loadingCore =
    workersQuery.isLoading ||
    teamsQuery.isLoading ||
    assignmentsQuery.isLoading;

  const errorCore =
    workersQuery.isError || teamsQuery.isError || assignmentsQuery.isError;

  const coreError =
    (workersQuery.error as Error | undefined) ??
    (teamsQuery.error as Error | undefined) ??
    (assignmentsQuery.error as Error | undefined);

  const isEmpty =
    workers.length === 0 && teams.length === 0 && assignments.length === 0;

  const recent = recentAssignments(assignments);

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-mission-control-page"
    >
      <PageHeader
        title="Virtual Office"
        subtitle="Mission Control — organize AI workers and teams in this workspace. Registering a worker does not start execution."
        actions={
          <>
            {canWrite ? (
              <>
                <LinkButton variant="secondary" to="/office/workers?register=1">
                  Add Worker
                </LinkButton>
                <LinkButton variant="secondary" to="/office/missions">
                  Missions
                </LinkButton>
                <LinkButton variant="secondary" to="/office/tasks/new">
                  Create Task
                </LinkButton>
                <LinkButton variant="primary" to="/office/teams?create=1">
                  Create Team
                </LinkButton>
              </>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={loadingCore}
              loading={loadingCore}
              onClick={() => {
                void workersQuery.refetch();
                void teamsQuery.refetch();
                void assignmentsQuery.refetch();
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <OfficeSectionNav active="mission-control" />

      {authQuery.data !== undefined ? (
        <p className="muted office-v2-workspace-line">
          Workspace <span className="mono">{authQuery.data.workspaceId}</span>
        </p>
      ) : null}

      {loadingCore ? (
        <LoadingBlock label="Loading Virtual Office data…" />
      ) : null}

      {errorCore && !loadingCore ? (
        <ErrorState
          title="Failed to load Mission Control"
          error={coreError ?? new Error("Request failed.")}
        />
      ) : null}

      {!loadingCore && !errorCore ? (
        <>
          <SectionPanel title="Workspace overview">
            <div
              className="overview-metrics"
              data-testid="office-overview-metrics"
            >
              <article className="metric-card">
                <p className="metric-label">Registered workers</p>
                <p className="metric-value">{counts.workers}</p>
                <p className="metric-detail muted">Office Worker records</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Teams</p>
                <p className="metric-value">{counts.teams}</p>
                <p className="metric-detail muted">Organizational groups</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Pending assignments</p>
                <p className="metric-value">{counts.pending}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Running assignments</p>
                <p className="metric-value">{counts.running}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Completed assignments</p>
                <p className="metric-value">{counts.completed}</p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Failed assignments</p>
                <p className="metric-value">{counts.failed}</p>
              </article>
            </div>
          </SectionPanel>

          {isEmpty ? (
            <EmptyState
              title="Your Virtual Office is ready to set up."
              description="Create an Agent, register an Office Worker linked to that Agent, form a Team, and add the worker to the team."
              action={
                <div className="office-v2-getting-started-actions">
                  <LinkButton variant="secondary" to="/agents/new">
                    1. Create Agent
                  </LinkButton>
                  <LinkButton
                    variant="secondary"
                    to="/office/workers?register=1"
                  >
                    2. Register Worker
                  </LinkButton>
                  <LinkButton variant="secondary" to="/office/teams?create=1">
                    3. Create Team
                  </LinkButton>
                </div>
              }
            />
          ) : null}

          <SectionPanel title="Teams">
            {teams.length === 0 ? (
              <p className="muted">No teams yet.</p>
            ) : (
              <ul className="office-v2-card-grid">
                {teams.map((team) => {
                  const memberCount = teamMemberCounts.get(team.id) ?? 0;
                  const teamWorkers = membershipQueries
                    .map((query, index) => {
                      const teamId = teams[index]?.id;
                      if (teamId !== team.id || query.data === undefined) {
                        return [];
                      }
                      return query.data.items
                        .map((m) => workerById.get(m.officeWorkerId))
                        .filter(
                          (w): w is OfficeWorkerResource => w !== undefined,
                        );
                    })
                    .flat();

                  return (
                    <li key={team.id} className="office-v2-entity-card">
                      <h3 className="office-v2-card-title">
                        <Link to={`/office/teams/${team.id}`}>{team.name}</Link>
                      </h3>
                      {team.description !== undefined ? (
                        <p className="muted office-v2-card-desc">
                          {team.description}
                        </p>
                      ) : null}
                      <p className="office-v2-card-meta">
                        {memberCount} worker{memberCount === 1 ? "" : "s"}
                      </p>
                      {teamWorkers.length > 0 ? (
                        <ul className="office-v2-chip-list">
                          {teamWorkers.map((worker) => (
                            <li key={worker.id}>
                              <Link
                                className="office-v2-entity-chip"
                                to={`/office/workers/${worker.id}`}
                              >
                                {worker.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionPanel>

          <SectionPanel title="Workers">
            {workers.length === 0 ? (
              <p className="muted">No workers registered.</p>
            ) : (
              <ul className="office-v2-card-grid">
                {workers.slice(0, 6).map((worker) => {
                  const teamLinks = workerMembershipTeamIds(
                    worker.id,
                    membershipQueries,
                    teams,
                  );
                  const agent = agentsQuery.data?.agents.find(
                    (item) => item.id === worker.agentId,
                  );
                  return (
                    <li key={worker.id} className="office-v2-entity-card">
                      <h3 className="office-v2-card-title">
                        <Link to={`/office/workers/${worker.id}`}>
                          {worker.name}
                        </Link>
                      </h3>
                      <p className="muted office-v2-card-desc">
                        Agent:{" "}
                        <Link className="mono" to={`/agents/${worker.agentId}`}>
                          {agent?.name ?? worker.agentId}
                        </Link>
                      </p>
                      {teamLinks.length > 0 ? (
                        <p className="office-v2-card-meta">
                          Teams:{" "}
                          {teamLinks
                            .map(
                              (id) =>
                                teams.find((t) => t.id === id)?.name ?? id,
                            )
                            .join(", ")}
                        </p>
                      ) : (
                        <p className="muted office-v2-card-meta">
                          No team memberships
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {workers.length > 6 ? (
              <p className="muted">
                <Link to="/office/workers">
                  View all {workers.length} workers
                </Link>
              </p>
            ) : null}
          </SectionPanel>

          <SectionPanel title="Recent assignments">
            {recent.length === 0 ? (
              <p className="muted">
                No assignments yet.{" "}
                <Link to="/office/tasks/new">Create a task</Link> or browse{" "}
                <Link to="/office/missions">missions</Link>.
              </p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Worker</th>
                      <th scope="col">Status</th>
                      <th scope="col">Created</th>
                      <th scope="col">Execution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((assignment) => {
                      const worker = workerById.get(assignment.officeWorkerId);
                      const executionLink =
                        assignment.runId !== undefined
                          ? `/runs/${assignment.runId}`
                          : assignment.workflowRunId !== undefined
                            ? `/workflow-runs/${assignment.workflowRunId}`
                            : undefined;
                      return (
                        <tr key={assignment.id}>
                          <td>{assignment.title}</td>
                          <td>
                            {worker !== undefined ? (
                              <Link to={`/office/workers/${worker.id}`}>
                                {worker.name}
                              </Link>
                            ) : (
                              <span className="mono">
                                {assignment.officeWorkerId}
                              </span>
                            )}
                          </td>
                          <td>
                            <StatusChip
                              status={assignment.status}
                              category={assignmentStatusCategory(
                                assignment.status,
                              )}
                            />
                          </td>
                          <td>{formatTimestamp(assignment.createdAt)}</td>
                          <td>
                            {executionLink !== undefined ? (
                              <Link className="mono" to={executionLink}>
                                Open
                              </Link>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionPanel>
        </>
      ) : null}
    </div>
  );
}
