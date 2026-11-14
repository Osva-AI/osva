import { Link } from "react-router-dom";

import type { ConnectorCatalogEntry } from "../../lib/osva-connectors-catalog";
import { CONNECTOR_CAPABILITY_CATEGORIES } from "../../lib/osva-connectors-catalog";
import type { CatalogWorkspaceIntegrationStatus } from "../../lib/connector-workspace-status";
import {
  ConnectorToolRiskBadge,
  ConnectorTransportBadge,
  ConnectorWorkspaceStatusBadge,
} from "./connector-catalog-badges";

function capabilityLabel(
  category: ConnectorCatalogEntry["capabilityCategory"],
): string {
  return (
    CONNECTOR_CAPABILITY_CATEGORIES.find((c) => c.id === category)?.label ??
    category
  );
}

export function ConnectorCatalogCard({
  entry,
  workspaceStatus,
}: {
  readonly entry: ConnectorCatalogEntry;
  readonly workspaceStatus?: CatalogWorkspaceIntegrationStatus;
}) {
  return (
    <article
      className="example-catalog-card connector-catalog-card"
      data-testid={`connector-catalog-card-${entry.connectorId}`}
    >
      <header className="example-catalog-card-header">
        <div>
          <p className="example-catalog-card-kicker">
            {entry.provider} · {capabilityLabel(entry.capabilityCategory)}
          </p>
          <h3 className="example-catalog-card-title">
            <Link to={`/tools/connectors/catalog/${entry.connectorId}`}>
              {entry.shortTitle}
            </Link>
          </h3>
        </div>
      </header>
      <p className="example-catalog-card-description">
        {entry.capabilitySummary} · {entry.tools.count} documented MCP tools ·{" "}
        <span className="mono">
          {entry.npmPackage}@{entry.publishedVersion}
        </span>
      </p>
      <div className="example-badge-row">
        <ConnectorTransportBadge transport={entry.mcpTransport} />
        <ConnectorToolRiskBadge toolRisk={entry.toolRisk} />
        {workspaceStatus !== undefined ? (
          <ConnectorWorkspaceStatusBadge status={workspaceStatus} />
        ) : null}
      </div>
      <p className="muted connector-catalog-auth-hint">
        Auth: {entry.authentication.method}
      </p>
      <div className="action-row example-catalog-card-actions">
        <Link
          className="button primary"
          to={`/tools/connectors/catalog/${entry.connectorId}`}
        >
          View connector
        </Link>
        <a
          className="button button-secondary"
          href={entry.installGuideUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Install guide
        </a>
      </div>
    </article>
  );
}
