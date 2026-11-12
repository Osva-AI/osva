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
import { useAgentsListQuery } from "../hooks/use-agents";
import {
  useAllTeamMembershipsQuery,
  useCreateOfficeWorkerMutation,
  useOfficeTeamsQuery,
  useOfficeWorkersQuery,
} from "../hooks/use-office";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { ConsoleApiError } from "../lib/console-api";
import { formatTimestamp } from "../lib/formatting";
import { slugOfficeKeyFromName } from "../lib/office-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function OfficeWorkersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const workersQuery = useOfficeWorkersQuery();
  const teamsQuery = useOfficeTeamsQuery();
  const agentsQuery = useAgentsListQuery();
  const createWorker = useCreateOfficeWorkerMutation();

  const [filter, setFilter] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  const showRegister = searchParams.get("register") === "1";

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const workers = workersQuery.data?.items ?? [];
  const teams = teamsQuery.data?.items ?? [];
  const membershipQueries = useAllTeamMembershipsQuery(teams.map((t) => t.id));

  const teamNamesByWorker = useMemo(() => {
    const map = new Map<string, string[]>();
    for (let index = 0; index < membershipQueries.length; index += 1) {
      const query = membershipQueries[index];
      if (query === undefined) {
        continue;
      }
      const team = teams[index];
      if (team === undefined || query.data === undefined) {
        continue;
      }
      for (const membership of query.data.items) {
        const current = map.get(membership.officeWorkerId) ?? [];
        current.push(team.name);
        map.set(membership.officeWorkerId, current);
      }
    }
    return map;
  }, [membershipQueries, teams]);

  const filteredWorkers = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) {
      return workers;
    }
    return workers.filter(
      (worker) =>
        worker.name.toLowerCase().includes(needle) ||
        worker.key.toLowerCase().includes(needle),
    );
  }, [filter, workers]);

  function closeRegister(): void {
    const next = new URLSearchParams(searchParams);
    next.delete("register");
    setSearchParams(next, { replace: true });
    setFeedback(undefined);
    setErrorRequestId(undefined);
  }

  async function submitRegister(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      return;
    }
    setFeedback(undefined);
    setErrorRequestId(undefined);

    const trimmedKey = key.trim();
    const trimmedName = name.trim();
    if (
      trimmedKey.length === 0 ||
      trimmedName.length === 0 ||
      agentId.length === 0
    ) {
      setFeedback("Worker key, name, and agent are required.");
      return;
    }

    try {
      const worker = await createWorker.mutateAsync({
        key: trimmedKey,
        name: trimmedName,
        agentId,
        ...(description.trim().length > 0
          ? { description: description.trim() }
          : {}),
      });
      closeRegister();
      navigate(`/office/workers/${worker.id}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Register failed.");
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-workers-page"
    >
      <PageHeader
        title="Workers"
        subtitle="Office Workers are durable identities linked to OSVA Agents. Registering does not start a Run or consume model tokens."
        actions={
          <>
            {canWrite ? (
              <LinkButton variant="primary" to="/office/workers?register=1">
                Register Worker
              </LinkButton>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              loading={workersQuery.isFetching}
              disabled={workersQuery.isFetching}
              onClick={() => void workersQuery.refetch()}
            >
              Refresh
            </Button>
          </>
        }
      />

      <OfficeSectionNav active="workers" />

      {!canWrite ? (
        <p className="muted">
          Registering workers requires an EDITOR or ADMIN role.
        </p>
      ) : null}

      {showRegister && canWrite ? (
        <SectionPanel title="Register Office Worker">
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
            onSubmit={(event) => void submitRegister(event)}
          >
            <div className="filters">
              <div className="field">
                <label htmlFor="worker-name">Display name</label>
                <input
                  id="worker-name"
                  value={name}
                  disabled={createWorker.isPending}
                  onChange={(event) => {
                    const next = event.target.value;
                    setName(next);
                    if (!keyTouched) {
                      setKey(slugOfficeKeyFromName(next));
                    }
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="worker-key">Worker key</label>
                <input
                  id="worker-key"
                  className="mono"
                  value={key}
                  disabled={createWorker.isPending}
                  onChange={(event) => {
                    setKeyTouched(true);
                    setKey(event.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="worker-agent">Linked Agent</label>
                <select
                  id="worker-agent"
                  value={agentId}
                  disabled={createWorker.isPending || agentsQuery.isLoading}
                  onChange={(event) => {
                    setAgentId(event.target.value);
                  }}
                >
                  <option value="">Select agent…</option>
                  {(agentsQuery.data?.agents ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.key})
                    </option>
                  ))}
                </select>
              </div>
              {(agentsQuery.data?.agents.length ?? 0) === 0 ? (
                <p className="muted">
                  No agents in this workspace.{" "}
                  <Link to="/agents/new">Create an Agent</Link> first.
                </p>
              ) : null}
              <div className="field">
                <label htmlFor="worker-description">
                  Description (optional)
                </label>
                <textarea
                  id="worker-description"
                  value={description}
                  rows={3}
                  disabled={createWorker.isPending}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                />
              </div>
            </div>
            <div className="toolbar">
              <Button
                type="submit"
                variant="primary"
                loading={createWorker.isPending}
              >
                Register worker
              </Button>
              <Button type="button" variant="secondary" onClick={closeRegister}>
                Cancel
              </Button>
            </div>
          </form>
        </SectionPanel>
      ) : null}

      <div className="filters">
        <div className="field">
          <label htmlFor="worker-filter">Filter by name</label>
          <input
            id="worker-filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            placeholder="Search workers"
          />
        </div>
      </div>

      {workersQuery.isLoading ? (
        <LoadingBlock label="Loading workers…" />
      ) : null}
      {workersQuery.isError ? (
        <ErrorState title="Failed to load workers" error={workersQuery.error} />
      ) : null}

      {workersQuery.data !== undefined && filteredWorkers.length === 0 ? (
        <EmptyState
          title={
            workers.length === 0
              ? "No workers registered."
              : "No workers match filter."
          }
          description="Register an Office Worker and link it to an existing Agent."
          action={
            canWrite && workers.length === 0 ? (
              <LinkButton variant="primary" to="/office/workers?register=1">
                Register Worker
              </LinkButton>
            ) : undefined
          }
        />
      ) : null}

      {filteredWorkers.length > 0 ? (
        <SectionPanel title="Worker directory">
          <DataTableRegion caption="Office Workers in this workspace">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Agent</th>
                <th scope="col">Teams</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredWorkers.map((worker) => {
                const agent = agentsQuery.data?.agents.find(
                  (item) => item.id === worker.agentId,
                );
                const teamNames = teamNamesByWorker.get(worker.id) ?? [];
                return (
                  <tr key={worker.id}>
                    <td>
                      <Link to={`/office/workers/${worker.id}`}>
                        {worker.name}
                      </Link>
                    </td>
                    <td className="mono">{worker.key}</td>
                    <td>
                      <Link className="mono" to={`/agents/${worker.agentId}`}>
                        {agent?.name ?? worker.agentId}
                      </Link>
                    </td>
                    <td>{teamNames.length > 0 ? teamNames.join(", ") : "—"}</td>
                    <td>{formatTimestamp(worker.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTableRegion>
        </SectionPanel>
      ) : null}
    </div>
  );
}
