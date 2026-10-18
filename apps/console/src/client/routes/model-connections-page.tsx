import { useState } from "react";
import { Link } from "react-router-dom";

import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useCreateModelProviderConnectionMutation,
  useModelProviderConnectionsListQuery,
} from "../hooks/use-models";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function ModelConnectionsPage() {
  const authQuery = useAuthContextQuery();
  const connectionsQuery = useModelProviderConnectionsListQuery();
  const createMutation = useCreateModelProviderConnectionMutation();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("OPENAI");
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Provider connections</h1>
          <p className="page-subtitle">
            Workspace-owned provider connections with immutable versions.
          </p>
        </div>
        <Link className="button" to="/models">
          Back to models
        </Link>
      </header>

      {connectionsQuery.isLoading ? (
        <LoadingBlock label="Loading connections…" />
      ) : null}
      {connectionsQuery.isError ? (
        <ErrorState
          title="Failed to load connections"
          error={connectionsQuery.error}
        />
      ) : null}

      {canWrite ? (
        <section className="panel">
          <h2 className="section-title">Create connection</h2>
          <div className="filters">
            <div className="field">
              <label htmlFor="connection-key">Key</label>
              <input
                id="connection-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="connection-name">Name</label>
              <input
                id="connection-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="connection-provider">Provider</label>
              <select
                id="connection-provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              >
                <option value="OPENAI">OPENAI</option>
                <option value="ANTHROPIC">ANTHROPIC</option>
                <option value="GOOGLE_GEMINI">GOOGLE_GEMINI</option>
              </select>
            </div>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={
              createMutation.isPending ||
              key.trim().length === 0 ||
              name.trim().length === 0
            }
            onClick={() =>
              void createMutation.mutateAsync({ key, name, provider })
            }
          >
            Create connection
          </button>
        </section>
      ) : null}

      {connectionsQuery.data !== undefined ? (
        <section className="panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Key</th>
                </tr>
              </thead>
              <tbody>
                {connectionsQuery.data.connections.map((connection) => (
                  <tr key={connection.id}>
                    <td>
                      <Link to={`/models/connections/${connection.id}`}>
                        {connection.name}
                      </Link>
                    </td>
                    <td>{connection.provider}</td>
                    <td className="mono">{connection.key}</td>
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
