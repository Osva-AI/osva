import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { OfficeSectionNav } from "../components/office/office-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import {
  useAllTeamMembershipsQuery,
  useCreateOfficeTeamMutation,
  useOfficeTeamsQuery,
} from "../hooks/use-office";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { ConsoleApiError } from "../lib/console-api";
import { formatTimestamp } from "../lib/formatting";
import { slugOfficeKeyFromName } from "../lib/office-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function OfficeTeamsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const teamsQuery = useOfficeTeamsQuery();
  const createTeam = useCreateOfficeTeamMutation();

  const [filter, setFilter] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  const showCreate = searchParams.get("create") === "1";

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const teams = teamsQuery.data?.items ?? [];
  const teamIds = teams.map((team) => team.id);
  const membershipQueries = useAllTeamMembershipsQuery(teamIds);

  const memberCounts = useMemo(() => {
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

  const filteredTeams = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) {
      return teams;
    }
    return teams.filter(
      (team) =>
        team.name.toLowerCase().includes(needle) ||
        team.key.toLowerCase().includes(needle),
    );
  }, [filter, teams]);

  function closeCreate(): void {
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next, { replace: true });
    setFeedback(undefined);
    setErrorRequestId(undefined);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      return;
    }
    setFeedback(undefined);
    setErrorRequestId(undefined);

    const trimmedKey = key.trim();
    const trimmedName = name.trim();
    if (trimmedKey.length === 0 || trimmedName.length === 0) {
      setFeedback("Team key and name are required.");
      return;
    }

    try {
      const team = await createTeam.mutateAsync({
        key: trimmedKey,
        name: trimmedName,
        ...(description.trim().length > 0
          ? { description: description.trim() }
          : {}),
      });
      closeCreate();
      navigate(`/office/teams/${team.id}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Create failed.");
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-teams-page"
    >
      <PageHeader
        title="Teams"
        subtitle="Group Office Workers into teams. Memberships link workers to teams; removing members is not supported in this milestone."
        actions={
          <>
            {canWrite ? (
              <LinkButton
                variant="primary"
                to="/office/teams?create=1"
                onClick={() => {
                  setSearchParams({ create: "1" });
                }}
              >
                Create Team
              </LinkButton>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              loading={teamsQuery.isFetching}
              disabled={teamsQuery.isFetching}
              onClick={() => void teamsQuery.refetch()}
            >
              Refresh
            </Button>
          </>
        }
      />

      <OfficeSectionNav active="teams" />

      {!canWrite ? (
        <p className="muted">
          Creating teams requires an EDITOR or ADMIN role.
        </p>
      ) : null}

      {showCreate && canWrite ? (
        <SectionPanel title="Create team">
          {feedback !== undefined ? (
            <p className="form-feedback error" role="alert">
              {feedback}
              {errorRequestId !== undefined ? (
                <span className="mono"> Request ID: {errorRequestId}</span>
              ) : null}
            </p>
          ) : null}
          <form
            className="panel"
            onSubmit={(event) => void submitCreate(event)}
          >
            <div className="filters">
              <div className="field">
                <label htmlFor="team-name">Team name</label>
                <input
                  id="team-name"
                  value={name}
                  disabled={createTeam.isPending}
                  onChange={(event) => {
                    const next = event.target.value;
                    setName(next);
                    if (!keyTouched) {
                      setKey(slugOfficeKeyFromName(next));
                    }
                    setFeedback(undefined);
                  }}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="team-key">Team key</label>
                <input
                  id="team-key"
                  className="mono"
                  value={key}
                  disabled={createTeam.isPending}
                  onChange={(event) => {
                    setKeyTouched(true);
                    setKey(event.target.value);
                    setFeedback(undefined);
                  }}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="team-description">Description (optional)</label>
                <textarea
                  id="team-description"
                  value={description}
                  disabled={createTeam.isPending}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                  rows={3}
                />
              </div>
            </div>
            <div className="toolbar">
              <Button
                type="submit"
                variant="primary"
                loading={createTeam.isPending}
                disabled={createTeam.isPending}
              >
                Create team
              </Button>
              <Button type="button" variant="secondary" onClick={closeCreate}>
                Cancel
              </Button>
            </div>
          </form>
        </SectionPanel>
      ) : null}

      <div className="filters">
        <div className="field">
          <label htmlFor="team-filter">Filter by name</label>
          <input
            id="team-filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            placeholder="Search teams"
            autoComplete="off"
          />
        </div>
      </div>

      {teamsQuery.isLoading ? <LoadingBlock label="Loading teams…" /> : null}
      {teamsQuery.isError ? (
        <ErrorState title="Failed to load teams" error={teamsQuery.error} />
      ) : null}

      {teamsQuery.data !== undefined && filteredTeams.length === 0 ? (
        <EmptyState
          title={
            teams.length === 0 ? "No teams yet." : "No teams match filter."
          }
          description="Teams organize workers in your Virtual Office."
          action={
            canWrite && teams.length === 0 ? (
              <LinkButton variant="primary" to="/office/teams?create=1">
                Create Team
              </LinkButton>
            ) : undefined
          }
        />
      ) : null}

      {filteredTeams.length > 0 ? (
        <SectionPanel title="Team directory">
          <DataTableRegion caption="Teams in this workspace">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Workers</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <Link to={`/office/teams/${team.id}`}>{team.name}</Link>
                  </td>
                  <td className="mono">{team.key}</td>
                  <td>{memberCounts.get(team.id) ?? 0}</td>
                  <td>{formatTimestamp(team.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTableRegion>
        </SectionPanel>
      ) : null}
    </div>
  );
}
