import type { ConnectorCatalogToolRisk } from "../../lib/osva-connectors-catalog";
import type { CatalogWorkspaceIntegrationStatus } from "../../lib/connector-workspace-status";

export function ConnectorTransportBadge(props: {
  readonly transport: "stdio" | "streamable_http";
}) {
  return (
    <span
      className="example-badge example-badge-muted"
      data-testid="connector-transport-badge"
    >
      {props.transport === "stdio"
        ? "STDIO · operator-gated"
        : "Streamable HTTP"}
    </span>
  );
}

export function ConnectorToolRiskBadge(props: {
  readonly toolRisk: ConnectorCatalogToolRisk;
}) {
  const label =
    props.toolRisk === "read-only"
      ? "Read-only inventory"
      : props.toolRisk === "mutation-capable"
        ? "Includes mutation-capable tools"
        : "Read + mutation-capable tools";
  return (
    <span
      className={
        props.toolRisk === "read-only"
          ? "example-badge example-badge-verified"
          : "example-badge example-badge-live-path"
      }
      data-testid="connector-tool-risk-badge"
    >
      {label}
    </span>
  );
}

export function ConnectorWorkspaceStatusBadge(props: {
  readonly status: CatalogWorkspaceIntegrationStatus;
}) {
  const label =
    props.status === "catalog-only"
      ? "No linked connector"
      : props.status === "identity-created"
        ? "Identity only"
        : props.status === "version-configured"
          ? "Version configured"
          : "Tools imported";
  return (
    <span
      className="example-badge example-badge-muted"
      data-testid="connector-workspace-status-badge"
    >
      {label}
    </span>
  );
}
