import { Link } from "react-router-dom";
import { useState } from "react";

import { IntegrationsSectionNav } from "../components/integrations/integrations-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { TextField } from "../components/ui/field";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useConnectorsListQuery,
  useConnectorVersionsQuery,
  useCreateConnectorMutation,
} from "../hooks/use-tools-connectors";
import {
  connectorTransportSummary,
  describeIntegrationsWriteRoleRequirement,
  formatTransportLabel,
} from "../lib/tool-resource-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

function ConnectorLatestSummary(props: { readonly connectorId: string }) {
  const versionsQuery = useConnectorVersionsQuery(props.connectorId);
  if (versionsQuery.isLoading) {
    return <>…</>;
  }
  const versions = versionsQuery.data?.versions ?? [];
  if (versions.length === 0) {
    return <span className="muted">No versions yet</span>;
  }
  const latest = versions.reduce((left, right) =>
    right.version > left.version ? right : left,
  );
  return (
    <>
      {formatTransportLabel(latest.transport)} ·{" "}
      <span className="mono">{connectorTransportSummary(latest)}</span>
    </>
  );
}

function ConnectorVersionCount(props: { readonly connectorId: string }) {
  const versionsQuery = useConnectorVersionsQuery(props.connectorId);
  if (versionsQuery.isLoading) {
    return <>…</>;
  }
  return <>{versionsQuery.data?.versions.length ?? 0}</>;
}

export function ConnectorsPage() {
  const workspaceId = useWorkspaceQueryScope();
  const authQuery = useAuthContextQuery();
  const connectorsQuery = useConnectorsListQuery();
  const createMutation = useCreateConnectorMutation();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  if (workspaceId === undefined) {
    return <LoadingBlock label="Select a workspace to manage connectors." />;
  }

  return (
    <div
      className="integrations-v2 page-stack activity-v2"
      data-testid="integrations-connectors-page"
    >
      <PageHeader
        title="Workspace connectors"
        subtitle="Configured MCP connector identities in this workspace. Browse the published catalog for available packages."
        actions={
          <>
            <LinkButton variant="secondary" to="/tools/connectors/catalog">
              Browse catalog
            </LinkButton>
            <button
              type="button"
              className="button"
              onClick={() => void connectorsQuery.refetch()}
              disabled={connectorsQuery.isFetching}
            >
              Refresh
            </button>
          </>
        }
      />

      <IntegrationsSectionNav active="connectors" />

      {!canWrite ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">{describeIntegrationsWriteRoleRequirement()}</p>
        </section>
      ) : null}

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
        <SectionPanel
          title="Create connector"
          description="Keys must be unique in the workspace."
          className="integrations-v2-create-panel"
        >
          <div className="filters integrations-v2-filters">
            <TextField
              id="connector-key"
              label="Key"
              required
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <TextField
              id="connector-name"
              label="Name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              id="connector-description"
              label="Description"
              optional
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="primary"
            loading={createMutation.isPending}
            disabled={key.trim().length === 0 || name.trim().length === 0}
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
          </Button>
        </SectionPanel>
      ) : null}

      {connectorsQuery.data !== undefined ? (
        <SectionPanel title="Connectors">
          {connectorsQuery.data.connectors.length === 0 ? (
            <EmptyState
              title="No MCP connectors"
              description="Create a connector, append a Streamable HTTP version, then discover and import tools."
            />
          ) : (
            <DataTableRegion caption="MCP connectors">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Latest transport</th>
                  <th scope="col">Versions</th>
                  <th scope="col">Key</th>
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
                    <td>
                      <ConnectorLatestSummary connectorId={connector.id} />
                    </td>
                    <td>
                      <ConnectorVersionCount connectorId={connector.id} />
                    </td>
                    <td className="mono">
                      <details className="integrations-v2-tech-details">
                        <summary>Show key</summary>
                        {connector.key}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTableRegion>
          )}
        </SectionPanel>
      ) : null}
    </div>
  );
}
