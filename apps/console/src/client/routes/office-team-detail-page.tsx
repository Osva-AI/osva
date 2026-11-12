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
import {
  useAddTeamMembershipMutation,
  useCreateOfficeRoleMutation,
  useOfficeRolesQuery,
  useOfficeTeamQuery,
  useOfficeWorkersQuery,
  useTeamMembershipsQuery,
  useUpdateOfficeTeamMutation,
} from "../hooks/use-office";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { ConsoleApiError } from "../lib/console-api";
import { formatTimestamp } from "../lib/formatting";
import { slugOfficeKeyFromName } from "../lib/office-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function OfficeTeamDetailPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const authQuery = useAuthContextQuery();
  const teamQuery = useOfficeTeamQuery(teamId);
  const membershipsQuery = useTeamMembershipsQuery(teamId);
  const workersQuery = useOfficeWorkersQuery();
  const rolesQuery = useOfficeRolesQuery();
  const updateTeam = useUpdateOfficeTeamMutation(teamId ?? "");
  const addMember = useAddTeamMembershipMutation(teamId ?? "");
  const createRole = useCreateOfficeRoleMutation();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editFeedback, setEditFeedback] = useState<string | undefined>();

  const [workerId, setWorkerId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [memberFeedback, setMemberFeedback] = useState<string | undefined>();
  const [memberErrorRequestId, setMemberErrorRequestId] = useState<
    string | undefined
  >();

  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleKey, setRoleKey] = useState("");
  const [roleKeyTouched, setRoleKeyTouched] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [roleFeedback, setRoleFeedback] = useState<string | undefined>();

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const workersById = useMemo(() => {
    const map = new Map(
      (workersQuery.data?.items ?? []).map((worker) => [worker.id, worker]),
    );
    return map;
  }, [workersQuery.data?.items]);

  const rolesById = useMemo(() => {
    const map = new Map(
      (rolesQuery.data?.items ?? []).map((role) => [role.id, role]),
    );
    return map;
  }, [rolesQuery.data?.items]);

  const notFound =
    teamQuery.isError &&
    teamQuery.error instanceof ConsoleApiError &&
    teamQuery.error.status === 404;

  if (teamId === undefined) {
    return (
      <ErrorState title="Invalid route" error={new Error("Missing teamId.")} />
    );
  }

  function beginEdit(): void {
    if (teamQuery.data === undefined) {
      return;
    }
    setName(teamQuery.data.name);
    setDescription(teamQuery.data.description ?? "");
    setEditing(true);
    setEditFeedback(undefined);
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      return;
    }
    setEditFeedback(undefined);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setEditFeedback("Team name is required.");
      return;
    }
    try {
      await updateTeam.mutateAsync({
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

  async function submitMember(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || workerId.length === 0) {
      setMemberFeedback("Select a worker to add.");
      return;
    }
    setMemberFeedback(undefined);
    setMemberErrorRequestId(undefined);

    const existing = membershipsQuery.data?.items.some(
      (item) => item.officeWorkerId === workerId,
    );
    if (existing) {
      setMemberFeedback("This worker is already on the team.");
      return;
    }

    try {
      await addMember.mutateAsync({
        officeWorkerId: workerId,
        ...(roleId.length > 0 ? { roleId } : {}),
      });
      setWorkerId("");
      setRoleId("");
    } catch (error) {
      setMemberFeedback(
        error instanceof Error ? error.message : "Could not add member.",
      );
      if (error instanceof ConsoleApiError) {
        setMemberErrorRequestId(error.body.requestId);
      }
    }
  }

  async function submitRole(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      return;
    }
    setRoleFeedback(undefined);
    const trimmedKey = roleKey.trim();
    const trimmedName = roleName.trim();
    if (trimmedKey.length === 0 || trimmedName.length === 0) {
      setRoleFeedback("Role key and name are required.");
      return;
    }
    try {
      const role = await createRole.mutateAsync({
        key: trimmedKey,
        name: trimmedName,
        ...(roleDescription.trim().length > 0
          ? { description: roleDescription.trim() }
          : {}),
      });
      setRoleId(role.id);
      setShowRoleForm(false);
      setRoleKey("");
      setRoleName("");
      setRoleDescription("");
      setRoleKeyTouched(false);
    } catch (error) {
      setRoleFeedback(
        error instanceof Error ? error.message : "Create role failed.",
      );
    }
  }

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-team-detail-page"
    >
      <PageHeader
        title={teamQuery.data?.name ?? "Team"}
        subtitle="Team composition and Office Worker memberships."
        actions={
          <>
            <LinkButton variant="secondary" to="/office/teams">
              All teams
            </LinkButton>
            {canWrite && teamQuery.data !== undefined && !editing ? (
              <Button type="button" variant="secondary" onClick={beginEdit}>
                Edit team
              </Button>
            ) : null}
          </>
        }
      />

      <OfficeSectionNav active="teams" />

      {teamQuery.isLoading ? <LoadingBlock label="Loading team…" /> : null}
      {notFound ? (
        <EmptyState
          title="Team not found."
          description="This team is not visible in the selected workspace."
        />
      ) : null}
      {teamQuery.isError && !notFound ? (
        <ErrorState title="Failed to load team" error={teamQuery.error} />
      ) : null}

      {teamQuery.data !== undefined ? (
        <>
          {editing ? (
            <SectionPanel title="Edit team">
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
                    <label htmlFor="edit-team-name">Name</label>
                    <input
                      id="edit-team-name"
                      value={name}
                      disabled={updateTeam.isPending}
                      onChange={(event) => {
                        setName(event.target.value);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="edit-team-description">Description</label>
                    <textarea
                      id="edit-team-description"
                      value={description}
                      disabled={updateTeam.isPending}
                      onChange={(event) => {
                        setDescription(event.target.value);
                      }}
                      rows={3}
                    />
                  </div>
                  <p className="muted">
                    Team keys are immutable after creation.
                  </p>
                </div>
                <div className="toolbar">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={updateTeam.isPending}
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
            <SectionPanel title="Team profile">
              <dl className="meta-grid">
                <div>
                  <dt>Name</dt>
                  <dd>{teamQuery.data.name}</dd>
                </div>
                <div>
                  <dt>Key</dt>
                  <dd className="mono">{teamQuery.data.key}</dd>
                </div>
                <div>
                  <dt>Team ID</dt>
                  <dd className="mono">{teamQuery.data.id}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatTimestamp(teamQuery.data.createdAt)}</dd>
                </div>
                {teamQuery.data.description !== undefined ? (
                  <div>
                    <dt>Description</dt>
                    <dd>{teamQuery.data.description}</dd>
                  </div>
                ) : null}
              </dl>
            </SectionPanel>
          )}

          <SectionPanel title="Members">
            {membershipsQuery.isLoading ? (
              <LoadingBlock label="Loading memberships…" />
            ) : null}
            {membershipsQuery.isError ? (
              <ErrorState
                title="Failed to load memberships"
                error={membershipsQuery.error}
              />
            ) : null}
            {membershipsQuery.data !== undefined &&
            membershipsQuery.data.items.length === 0 ? (
              <p className="muted">No workers on this team yet.</p>
            ) : null}
            {membershipsQuery.data !== undefined &&
            membershipsQuery.data.items.length > 0 ? (
              <DataTableRegion caption="Office Workers on this team">
                <thead>
                  <tr>
                    <th scope="col">Worker</th>
                    <th scope="col">Role</th>
                    <th scope="col">Worker ID</th>
                  </tr>
                </thead>
                <tbody>
                  {membershipsQuery.data.items.map((membership) => {
                    const worker = workersById.get(membership.officeWorkerId);
                    const role =
                      membership.roleId !== undefined
                        ? rolesById.get(membership.roleId)
                        : undefined;
                    return (
                      <tr
                        key={`${membership.teamId}-${membership.officeWorkerId}`}
                      >
                        <td>
                          {worker !== undefined ? (
                            <Link to={`/office/workers/${worker.id}`}>
                              {worker.name}
                            </Link>
                          ) : (
                            <span className="mono">
                              {membership.officeWorkerId}
                            </span>
                          )}
                        </td>
                        <td>{role?.name ?? "—"}</td>
                        <td className="mono">{membership.officeWorkerId}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTableRegion>
            ) : null}
          </SectionPanel>

          {canWrite ? (
            <SectionPanel title="Add worker to team">
              <p className="muted">
                Memberships represent Office Workers only. Removing a member is
                not supported by the API in M22.1.
              </p>
              {memberFeedback !== undefined ? (
                <p className="form-feedback error" role="alert">
                  {memberFeedback}
                  {memberErrorRequestId !== undefined ? (
                    <span className="mono">
                      {" "}
                      Request ID: {memberErrorRequestId}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <form
                className="panel"
                onSubmit={(event) => void submitMember(event)}
              >
                <div className="filters">
                  <div className="field">
                    <label htmlFor="add-worker">Office Worker</label>
                    <select
                      id="add-worker"
                      value={workerId}
                      disabled={addMember.isPending || workersQuery.isLoading}
                      onChange={(event) => {
                        setWorkerId(event.target.value);
                        setMemberFeedback(undefined);
                      }}
                    >
                      <option value="">Select worker…</option>
                      {(workersQuery.data?.items ?? []).map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.name} ({worker.key})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="add-role">Office role (optional)</label>
                    <select
                      id="add-role"
                      value={roleId}
                      disabled={addMember.isPending}
                      onChange={(event) => {
                        setRoleId(event.target.value);
                      }}
                    >
                      <option value="">No role</option>
                      {(rolesQuery.data?.items ?? []).map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="toolbar">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={addMember.isPending}
                    disabled={
                      addMember.isPending ||
                      (workersQuery.data?.items.length ?? 0) === 0
                    }
                  >
                    Add to team
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setShowRoleForm((open) => !open);
                    }}
                  >
                    {showRoleForm ? "Hide role form" : "Create role"}
                  </Button>
                </div>
              </form>

              {(workersQuery.data?.items.length ?? 0) === 0 ? (
                <p className="muted">
                  <Link to="/office/workers?register=1">Register a worker</Link>{" "}
                  before adding members.
                </p>
              ) : null}

              {showRoleForm ? (
                <form
                  className="panel office-v2-nested-form"
                  onSubmit={(event) => void submitRole(event)}
                >
                  <h3 className="panel-title">Create Office role</h3>
                  {roleFeedback !== undefined ? (
                    <p className="form-feedback error" role="alert">
                      {roleFeedback}
                    </p>
                  ) : null}
                  <div className="filters">
                    <div className="field">
                      <label htmlFor="role-name">Role name</label>
                      <input
                        id="role-name"
                        value={roleName}
                        onChange={(event) => {
                          const next = event.target.value;
                          setRoleName(next);
                          if (!roleKeyTouched) {
                            setRoleKey(slugOfficeKeyFromName(next));
                          }
                        }}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="role-key">Role key</label>
                      <input
                        id="role-key"
                        className="mono"
                        value={roleKey}
                        onChange={(event) => {
                          setRoleKeyTouched(true);
                          setRoleKey(event.target.value);
                        }}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="role-description">Description</label>
                      <textarea
                        id="role-description"
                        value={roleDescription}
                        rows={2}
                        onChange={(event) => {
                          setRoleDescription(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={createRole.isPending}
                  >
                    Create role
                  </Button>
                </form>
              ) : null}
            </SectionPanel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
