import type {
  ConnectorVersionResource,
  ToolVersionResource,
} from "../hooks/use-tools-connectors";

export function describeIntegrationsWriteRoleRequirement(): string {
  return "Creating or changing integrations requires Developer, Admin, or Owner.";
}

export function formatToolTypeLabel(type: string): string {
  if (type === "INTERNAL") {
    return "Internal";
  }
  if (type === "MCP") {
    return "MCP";
  }
  return type;
}

export function formatTransportLabel(
  transport: ConnectorVersionResource["transport"],
): string {
  if (transport === "STREAMABLE_HTTP") {
    return "Streamable HTTP";
  }
  if (transport === "STDIO") {
    return "STDIO";
  }
  return transport;
}

export function connectorTransportSummary(
  version: ConnectorVersionResource,
): string {
  const cfg = version.transportConfig;
  if ("endpointUrl" in cfg) {
    return cfg.endpointUrl;
  }
  return `${cfg.command} ${cfg.args.join(" ")}`.trim();
}

export function formatConnectorVersionOption(
  version: ConnectorVersionResource,
): string {
  const endpoint = connectorTransportSummary(version);
  const auth =
    version.auth?.configured === true
      ? version.auth.type
      : "No auth configured";
  return `v${String(version.version)} · ${formatTransportLabel(version.transport)} · ${endpoint} · ${auth}`;
}

export function formatConnectorAuthSummary(
  version: ConnectorVersionResource,
): string {
  if (version.auth === undefined) {
    return "None";
  }
  if (version.auth.type === "BEARER") {
    return "Bearer secret configured";
  }
  return `Header ${version.auth.headerName} configured`;
}

export function summarizeToolVersion(version: ToolVersionResource): {
  readonly typeLabel: string;
  readonly origin: string;
  readonly capability: string;
} {
  if (version.type === "INTERNAL") {
    return {
      typeLabel: "Internal",
      origin: "Workspace implementation",
      capability: version.implementation,
    };
  }
  return {
    typeLabel: "MCP",
    origin: version.mcp.remoteToolName,
    capability: version.mcp.description ?? version.mcp.remoteToolName,
  };
}

export function toolVersionSelectLabel(version: ToolVersionResource): string {
  const summary = summarizeToolVersion(version);
  return `v${String(version.version)} · ${summary.typeLabel} · ${summary.origin}`;
}
