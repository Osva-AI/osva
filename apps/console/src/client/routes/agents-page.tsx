import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAgentsListQuery } from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { formatTimestamp } from "../lib/formatting";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function AgentsPage() {
  const agentsQuery = useAgentsListQuery();
  const authQuery = useAuthContextQuery();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-subtitle">
            Agent registry in the authenticated workspace. Versions are
            immutable; launch individual Runs from an AgentVersion.
          </p>
        </div>
        <div className="toolbar">
          <Link className="button" to="/onboarding">
            First-agent guide
          </Link>
          {canWrite ? (
            <Link className="button primary" to="/agents/new">
              Register Agent
            </Link>
          ) : null}
          <button
            type="button"
            className="button"
            onClick={() => void agentsQuery.refetch()}
            disabled={agentsQuery.isFetching}
          >
            Refresh
          </button>
        </div>
      </header>

      {!canWrite ? (
        <p className="muted">
          Registering an Agent requires an EDITOR or ADMIN role. VIEWER can
          inspect existing Agents and versions.
        </p>
      ) : null}

      {agentsQuery.isLoading ? <LoadingBlock label="Loading agents…" /> : null}
      {agentsQuery.isError ? (
        <ErrorState title="Failed to load agents" error={agentsQuery.error} />
      ) : null}

      {agentsQuery.data !== undefined &&
      agentsQuery.data.agents.length === 0 ? (
        <EmptyState
          title="No agents yet."
          description="Register an Agent in this workspace, then append an immutable AgentVersion before launching a Run."
        />
      ) : null}

      {agentsQuery.data !== undefined && agentsQuery.data.agents.length > 0 ? (
        <section className="panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Agent ID</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {agentsQuery.data.agents.map((agent) => (
                  <tr key={agent.id}>
                    <td>{agent.name}</td>
                    <td className="mono">{agent.key}</td>
                    <td>
                      <Link className="mono" to={`/agents/${agent.id}`}>
                        {agent.id}
                      </Link>
                    </td>
                    <td>{formatTimestamp(agent.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
