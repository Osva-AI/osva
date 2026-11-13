import { Link, Navigate, useParams } from "react-router-dom";

import { IntegrationsSectionNav } from "../components/integrations/integrations-section-nav";
import {
  ConnectorToolRiskBadge,
  ConnectorTransportBadge,
  ConnectorWorkspaceStatusBadge,
} from "../components/connectors/connector-catalog-badges";
import { EmptyState } from "../components/empty-state/empty-state";
import { LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { useConnectorCatalogWorkspaceStatus } from "../hooks/use-connector-catalog-workspace";
import { describeCatalogWorkspaceIntegrationStatus } from "../lib/connector-workspace-status";
import {
  CONNECTOR_CATALOG_PROVENANCE,
  getConnectorCatalogEntry,
} from "../lib/osva-connectors-catalog";
import { getExampleById } from "../lib/osva-examples-catalog";
import {
  isAllowedOsvaConnectorsUrl,
  OSVA_CONNECTORS_AUDITED_SHA,
} from "../lib/osva-connectors-links";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { describeIntegrationsWriteRoleRequirement } from "../lib/tool-resource-presentation";

export function ConnectorCatalogDetailPage() {
  const { catalogConnectorId } = useParams<{ catalogConnectorId: string }>();
  const authQuery = useAuthContextQuery();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  if (catalogConnectorId === undefined) {
    return <Navigate to="/tools/connectors/catalog" replace />;
  }

  const entry = getConnectorCatalogEntry(catalogConnectorId);
  const workspaceStatus = useConnectorCatalogWorkspaceStatus(entry);

  if (entry === undefined) {
    return (
      <>
        <PageHeader title="Connector not in catalog" />
        <EmptyState
          title="Unknown catalog connector"
          description="Only published osva-connectors packages in the pinned snapshot are listed."
        />
        <LinkButton variant="primary" to="/tools/connectors/catalog">
          Browse catalog
        </LinkButton>
      </>
    );
  }

  const installAllowed = isAllowedOsvaConnectorsUrl(entry.installGuideUrl);
  const readmeAllowed = isAllowedOsvaConnectorsUrl(entry.packageReadmeUrl);
  const npmAllowed = isAllowedOsvaConnectorsUrl(entry.npmPackageUrl);

  return (
    <div
      className="integrations-v2 page-stack activity-v2"
      data-testid="connector-catalog-detail-page"
    >
      <PageHeader
        title={entry.shortTitle}
        subtitle={entry.capabilitySummary}
        actions={
          <LinkButton variant="secondary" to="/tools/connectors/catalog">
            Back to catalog
          </LinkButton>
        }
      />

      <IntegrationsSectionNav active="catalog" />

      <div className="example-detail-stack">
        <SectionPanel title="At a glance">
          <div className="example-badge-row">
            <ConnectorTransportBadge transport={entry.mcpTransport} />
            <ConnectorToolRiskBadge toolRisk={entry.toolRisk} />
            {workspaceStatus !== undefined ? (
              <ConnectorWorkspaceStatusBadge status={workspaceStatus.status} />
            ) : null}
          </div>
          <p className="muted">
            Provider <strong>{entry.provider}</strong> · catalog id{" "}
            <code className="mono">{entry.connectorId}</code> · workspace key{" "}
            <code className="mono">{entry.connectorKey}</code>
          </p>
          <p className="muted">
            Published{" "}
            <code className="mono">
              {entry.npmPackage}@{entry.publishedVersion}
            </code>{" "}
            · connector-sdk {entry.sdkVersion} · audited{" "}
            <code className="mono">
              {OSVA_CONNECTORS_AUDITED_SHA.slice(0, 12)}…
            </code>
          </p>
          {workspaceStatus !== undefined ? (
            <>
              <p role="status">
                {describeCatalogWorkspaceIntegrationStatus(
                  workspaceStatus.status,
                )}
                {workspaceStatus.importedMcpToolCount > 0
                  ? ` (${String(workspaceStatus.importedMcpToolCount)} imported MCP ToolVersion${workspaceStatus.importedMcpToolCount === 1 ? "" : "s"}).`
                  : "."}
              </p>
              {workspaceStatus.status === "catalog-only" ? (
                <p className="muted">
                  A workspace connector with a different key (for example a
                  custom name) is not linked here. Create or rename using key{" "}
                  <code className="mono">{entry.connectorKey}</code> to
                  associate this catalog entry.
                </p>
              ) : null}
              {workspaceStatus.workspaceConnectorIds.length > 1 ? (
                <p className="muted" role="status">
                  Multiple workspace connectors share this catalog key; open the
                  workspace connector list to choose the right instance.
                </p>
              ) : null}
            </>
          ) : null}
        </SectionPanel>

        <SectionPanel title="What this connector does">
          <p>{entry.displayName}</p>
          <p className="muted">
            Package publication and documented MCP tool inventory are verified
            for this catalog entry. Live provider connectivity is not inferred
            from workspace configuration alone.
          </p>
        </SectionPanel>

        <SectionPanel
          title="Authentication & prerequisites"
          description="Credential env var names only — never store secrets in catalog data or browser forms without an approved storage contract."
        >
          <dl className="meta-list">
            <div>
              <dt>Method</dt>
              <dd>{entry.authentication.method}</dd>
            </div>
            <div>
              <dt>Required worker / secret env</dt>
              <dd>
                <ul className="example-detail-list">
                  {entry.authentication.requiredCredentialEnv.map((name) => (
                    <li key={name}>
                      <code className="mono">{name}</code>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>
                {entry.mcpTransport === "stdio"
                  ? "STDIO MCP (worker-spawned; operator must enable OSVA_MCP_STDIO_CONNECTORS_ENABLED)"
                  : "Streamable HTTP MCP endpoint configured on ConnectorVersion"}
              </dd>
            </div>
          </dl>
        </SectionPanel>

        <SectionPanel
          title="Documented MCP tools"
          description={
            entry.mutationClassificationHeuristic
              ? "Read-only vs mutation-capable lists are sourced from osva-connectors generator inventory (heuristic, not per-provider live acceptance)."
              : undefined
          }
        >
          <DataTableRegion caption="Tool inventory">
            <thead>
              <tr>
                <th scope="col">Tool name</th>
                <th scope="col">Classification</th>
              </tr>
            </thead>
            <tbody>
              {entry.tools.readOnly.map((tool) => (
                <tr key={tool}>
                  <td className="mono">{tool}</td>
                  <td>Read-only (inventory)</td>
                </tr>
              ))}
              {entry.tools.mutationCapable.map((tool) => (
                <tr key={tool}>
                  <td className="mono">{tool}</td>
                  <td>Mutation-capable (inventory)</td>
                </tr>
              ))}
            </tbody>
          </DataTableRegion>
        </SectionPanel>

        {entry.relatedExampleIds.length > 0 ? (
          <SectionPanel title="Related osva-examples">
            <ul className="example-detail-list">
              {entry.relatedExampleIds.map((exampleId) => {
                const example = getExampleById(exampleId);
                if (example === undefined) {
                  return (
                    <li key={exampleId}>
                      Example <code className="mono">{exampleId}</code> (not in
                      Console catalog)
                    </li>
                  );
                }
                return (
                  <li key={exampleId}>
                    <Link to={`/examples/${exampleId}`}>{example.title}</Link>
                    <span className="muted"> · {example.osvaVersion}</span>
                  </li>
                );
              })}
            </ul>
          </SectionPanel>
        ) : null}

        <SectionPanel title="Documentation">
          <ul className="example-detail-list">
            {installAllowed ? (
              <li>
                <a
                  href={entry.installGuideUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Installation guide (osva-connectors)
                </a>
              </li>
            ) : null}
            {readmeAllowed ? (
              <li>
                <a
                  href={entry.packageReadmeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Package README
                </a>
              </li>
            ) : null}
            {npmAllowed ? (
              <li>
                <a
                  href={entry.npmPackageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  npm package {entry.publishedVersion}
                </a>
              </li>
            ) : null}
          </ul>
          <p className="muted">
            Refresh: {CONNECTOR_CATALOG_PROVENANCE.refreshProcedure}
          </p>
        </SectionPanel>

        <SectionPanel title="Set up in this workspace">
          {!canWrite ? (
            <p className="muted">
              {describeIntegrationsWriteRoleRequirement()}
            </p>
          ) : (
            <p className="muted">
              Create a workspace connector with key{" "}
              <code className="mono">{entry.connectorKey}</code>, then follow
              the install guide on the worker. Console provisions Streamable
              HTTP ConnectorVersions only; STDIO requires operator-controlled
              provisioning.
            </p>
          )}
          <div className="action-row">
            {workspaceStatus?.workspaceConnectorId !== undefined ? (
              <LinkButton
                variant="primary"
                to={`/tools/connectors/${workspaceStatus.workspaceConnectorId}`}
              >
                Open workspace connector
              </LinkButton>
            ) : (
              <LinkButton variant="primary" to="/tools/connectors">
                Workspace connectors
              </LinkButton>
            )}
            {canWrite ? (
              <LinkButton variant="secondary" to="/tools/connectors">
                Create connector identity
              </LinkButton>
            ) : null}
          </div>
        </SectionPanel>
      </div>
    </div>
  );
}
