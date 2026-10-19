import { useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useConnectorsListQuery,
  useConnectorVersionsQuery,
  useCreateConnectorMutation,
} from "../hooks/use-tools-connectors";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

function ConnectorVersionCount(props: { readonly connectorId: string }) {
  const versionsQuery = useConnectorVersionsQuery(props.connectorId);
  if (versionsQuery.isLoading) {
    return <>…</>;
  }
  return <>{versionsQuery.data?.versions.length ?? 0}</>;
}

function ConnectorLatestTransport(props: { readonly connectorId: string }) {
  const versionsQuery = useConnectorVersionsQuery(props.connectorId);
  if (versionsQuery.isLoading) {
    return <>…</>;
  }
  const versions = versionsQuery.data?.versions ?? [];
  if (versions.length === 0) {
    return <>—</>;
  }
  const latest = versions.reduce((left, right) =>
    right.version > left.version ? right : left,
  );
  return <>{latest.transport}</>;
}

export function ConnectorsPage() {
  const authQuery = useAuthContextQuery();
  const connectorsQuery = useConnectorsListQuery();
  const createMutation = useCreateConnectorMutation();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Connectors</h1>
          <p className="page-subtitle">
            MCP connector identities with immutable ConnectorVersions.
            Credentials are secret references configured at version creation —
            never displayed after submit.
          </p>
        </div>
        <Link className="button" to="/tools">
          Back to tools
        </Link>
      </header>

      {connectorsQuery.isLoading ? (
        <LoadingBlock label="Loading connectors…" />
      ) : null}
      {connectorsQuery.isError ? (
        <ErrorState
          title="Failed to load connectors"
          error={connectorsQuery.error}
        />
      ) : null}

      {canWrite ? (
        <section className="panel">
          <h2 className="section-title">Create connector</h2>
          <div className="filters">
            <div className="field">
              <label htmlFor="connector-key">Key</label>
              <input
                id="connector-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="connector-name">Name</label>
              <input
                id="connector-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="connector-description">Description</label>
              <input
                id="connector-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
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
              void createMutation.mutateAsync({
                key: key.trim(),
                name: name.trim(),
                ...(description.trim().length > 0
                  ? { description: description.trim() }
                  : {}),
              })
            }
          >
            Create connector
          </button>
        </section>
      ) : null}

      {connectorsQuery.data !== undefined ? (
        <section className="panel">
          {connectorsQuery.data.connectors.length === 0 ? (
            <EmptyState
              title="No connectors yet."
              description="Create an MCP connector, append a ConnectorVersion, then discover and import tools."
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Transport (latest)</th>
                    <th>Versions</th>
                  </tr>
                </thead>
                <tbody>
                  {connectorsQuery.data.connectors.map((connector) => (
                    <tr key={connector.id}>
                      <td>
                        <Link to={`/tools/connectors/${connector.id}`}>
                          {connector.name}
                        </Link>
                      </td>
                      <td className="mono">{connector.key}</td>
                      <td>
                        <ConnectorLatestTransport connectorId={connector.id} />
                      </td>
                      <td>
                        <ConnectorVersionCount connectorId={connector.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
