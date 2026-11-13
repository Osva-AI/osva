import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { OfficeSectionNav } from "../components/office/office-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { WorkerAssignmentActivitySection } from "../components/office/worker-assignment-activity-section";
import { useAgentQuery } from "../hooks/use-agents";
import {
  useAllTeamMembershipsQuery,
  useOfficeRolesQuery,
  useOfficeTeamQuery,
  useOfficeTeamsQuery,
  useOfficeWorkerQuery,
  useUpdateOfficeWorkerMutation,
} from "../hooks/use-office";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { ConsoleApiError } from "../lib/console-api";
import { formatTimestamp } from "../lib/formatting";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

export function OfficeWorkerDetailPage() {
  const { workerId } = useParams<{ workerId: string }>();
  const workspaceId = useWorkspaceQueryScope();
  const authQuery = useAuthContextQuery();
  const workerQuery = useOfficeWorkerQuery(workerId);
  const agentQuery = useAgentQuery(workerQuery.data?.agentId);
  const teamsQuery = useOfficeTeamsQuery();
  const rolesQuery = useOfficeRolesQuery();
  const updateWorker = useUpdateOfficeWorkerMutation(workerId ?? "");

  const teams = teamsQuery.data?.items ?? [];
  const membershipQueries = useAllTeamMembershipsQuery(teams.map((t) => t.id));

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editFeedback, setEditFeedback] = useState<string | undefined>();

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const memberships = useMemo(() => {
    if (workerId === undefined) {
      return [];
    }
    const rows: Array<{
      readonly teamId: string;
      readonly roleId?: string;
    }> = [];
    for (let index = 0; index < membershipQueries.length; index += 1) {
      const query = membershipQueries[index];
      if (query === undefined) {
        continue;
      }
      const teamId = teams[index]?.id;
      if (teamId === undefined || query.data === undefined) {
        continue;
      }
      for (const item of query.data.items) {
        if (item.officeWorkerId === workerId) {
          rows.push({ teamId, roleId: item.roleId });
        }
      }
    }
    return rows;
  }, [membershipQueries, teams, workerId]);

  const rolesById = useMemo(
    () =>
      new Map((rolesQuery.data?.items ?? []).map((role) => [role.id, role])),
    [rolesQuery.data?.items],
  );

  const notFound =
    workerQuery.isError &&
    workerQuery.error instanceof ConsoleApiError &&
    workerQuery.error.status === 404;

  if (workerId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing workerId.")}
      />
    );
  }

  function beginEdit(): void {
    if (workerQuery.data === undefined) {
      return;
    }
    setName(workerQuery.data.name);
    setDescription(workerQuery.data.description ?? "");
    setEditing(true);
    setEditFeedback(undefined);
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setEditFeedback("Name is required.");
      return;
    }
    try {
      await updateWorker.mutateAsync({
        name: trimmedName,
        ...(description.trim().length > 0
          ? { description: description.trim() }
          : {}),
      });
      setEditing(false);
    } catch (error) {
      setEditFeedback(
        error instanceof Error ? error.message : "Update failed.",
      );
    }
  }

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-worker-detail-page"
    >
      <PageHeader
        title={workerQuery.data?.name ?? "Worker"}
        subtitle="Organizational identity linked to an Agent. Status here is not execution or presence."
        actions={
          <>
            <LinkButton variant="secondary" to="/office/workers">
              All workers
            </LinkButton>
            {workerQuery.data !== undefined ? (
              <LinkButton
                variant="secondary"
                to={`/agents/${workerQuery.data.agentId}`}
              >
                Open Agent
              </LinkButton>
            ) : null}
            {canWrite && workerQuery.data !== undefined && !editing ? (
              <Button type="button" variant="secondary" onClick={beginEdit}>
                Edit worker
              </Button>
            ) : null}
          </>
        }
      />

      <OfficeSectionNav active="workers" />

      {workerQuery.isLoading ? <LoadingBlock label="Loading worker…" /> : null}
      {notFound ? (
        <EmptyState
          title="Worker not found."
          description="This worker is not visible in the selected workspace."
        />
      ) : null}
      {workerQuery.isError && !notFound ? (
        <ErrorState title="Failed to load worker" error={workerQuery.error} />
      ) : null}

      {workerQuery.data !== undefined ? (
        <>
          {editing ? (
            <SectionPanel title="Edit worker">
              {editFeedback !== undefined ? (
                <p className="form-feedback error" role="alert">
                  {editFeedback}
                </p>
              ) : null}
              <form
                className="panel"
                onSubmit={(event) => void submitEdit(event)}
              >
                <div className="filters">
                  <div className="field">
                    <label htmlFor="edit-worker-name">Name</label>
                    <input
                      id="edit-worker-name"
                      value={name}
                      disabled={updateWorker.isPending}
                      onChange={(event) => {
                        setName(event.target.value);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="edit-worker-description">Description</label>
                    <textarea
                      id="edit-worker-description"
                      value={description}
                      rows={3}
                      disabled={updateWorker.isPending}
                      onChange={(event) => {
                        setDescription(event.target.value);
                      }}
                    />
                  </div>
                  <p className="muted">
                    Worker key and linked Agent cannot be changed here.
                  </p>
                </div>
                <div className="toolbar">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={updateWorker.isPending}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </SectionPanel>
          ) : (
            <SectionPanel title="Worker profile">
              <dl className="meta-grid">
                <div>
                  <dt>Name</dt>
                  <dd>{workerQuery.data.name}</dd>
                </div>
                <div>
                  <dt>Key</dt>
                  <dd className="mono">{workerQuery.data.key}</dd>
                </div>
                <div>
                  <dt>Worker ID</dt>
                  <dd className="mono">{workerQuery.data.id}</dd>
                </div>
                <div>
                  <dt>Linked Agent</dt>
                  <dd>
                    <Link
                      className="mono"
                      to={`/agents/${workerQuery.data.agentId}`}
                    >
                      {agentQuery.data?.name ?? workerQuery.data.agentId}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatTimestamp(workerQuery.data.createdAt)}</dd>
                </div>
                {workerQuery.data.description !== undefined ? (
                  <div>
                    <dt>Description</dt>
                    <dd>{workerQuery.data.description}</dd>
                  </div>
                ) : null}
              </dl>
            </SectionPanel>
          )}

          {workspaceId !== undefined ? (
            <WorkerAssignmentActivitySection
              workspaceId={workspaceId}
              officeWorkerId={workerQuery.data.id}
            />
          ) : null}

          <SectionPanel title="Team memberships">
            {membershipQueries.some((query) => query.isLoading) ? (
              <LoadingBlock label="Loading memberships…" />
            ) : null}
            {memberships.length === 0 ? (
              <p className="muted">
                Not assigned to any team.{" "}
                <Link to="/office/teams">Add via a team</Link>.
              </p>
            ) : (
              <DataTableRegion caption="Teams including this worker">
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col">Office role</th>
                  </tr>
                </thead>
                <tbody>
                  {memberships.map((membership) => (
                    <TeamMembershipRow
                      key={membership.teamId}
                      teamId={membership.teamId}
                      roleId={membership.roleId}
                      rolesById={rolesById}
                    />
                  ))}
                </tbody>
              </DataTableRegion>
            )}
          </SectionPanel>
        </>
      ) : null}
    </div>
  );
}

function TeamMembershipRow(props: {
  readonly teamId: string;
  readonly roleId?: string;
  readonly rolesById: ReadonlyMap<string, { readonly name: string }>;
}) {
  const teamQuery = useOfficeTeamQuery(props.teamId);
  const role =
    props.roleId !== undefined ? props.rolesById.get(props.roleId) : undefined;

  return (
    <tr>
      <td>
        {teamQuery.data !== undefined ? (
          <Link to={`/office/teams/${props.teamId}`}>
            {teamQuery.data.name}
          </Link>
        ) : (
          <span className="mono">{props.teamId}</span>
        )}
      </td>
      <td>{role?.name ?? "—"}</td>
    </tr>
  );
}
