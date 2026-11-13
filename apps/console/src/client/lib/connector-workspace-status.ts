import type {
  ConnectorResource,
  ToolVersionResource,
} from "../hooks/use-tools-connectors";

/** Workspace integration phase for a published catalog connector (not live provider health). */
export type CatalogWorkspaceIntegrationStatus =
  "catalog-only" | "identity-created" | "version-configured" | "tools-imported";

export function describeCatalogWorkspaceIntegrationStatus(
  status: CatalogWorkspaceIntegrationStatus,
): string {
  switch (status) {
    case "catalog-only":
      return "No linked workspace connector found (matches workspace key to catalog connectorKey only)";
    case "identity-created":
      return "Connector identity created · no ConnectorVersion yet";
    case "version-configured":
      return "ConnectorVersion configured · MCP tools not imported";
    case "tools-imported":
      return "MCP tools imported · provider connectivity not verified";
  }
}

export function resolveCatalogWorkspaceIntegration(params: {
  readonly catalogConnectorKey: string;
  readonly workspaceConnectors: readonly ConnectorResource[];
  readonly connectorVersionsByConnectorId: ReadonlyMap<
    string,
    readonly { readonly id: string }[]
  >;
  readonly mcpToolVersions: readonly ToolVersionResource[];
}): {
  readonly status: CatalogWorkspaceIntegrationStatus;
  readonly workspaceConnectorId?: string;
  readonly workspaceConnectorIds: readonly string[];
  readonly importedMcpToolCount: number;
  readonly importedMcpToolVersionIds: readonly string[];
} {
  const matches = params.workspaceConnectors.filter(
    (connector) => connector.key === params.catalogConnectorKey,
  );
  if (matches.length === 0) {
    return {
      status: "catalog-only",
      workspaceConnectorIds: [],
      importedMcpToolCount: 0,
      importedMcpToolVersionIds: [],
    };
  }

  const versionIds = new Set<string>();
  for (const connector of matches) {
    const versions =
      params.connectorVersionsByConnectorId.get(connector.id) ?? [];
    for (const version of versions) {
      versionIds.add(version.id);
    }
  }

  const importedMcp = params.mcpToolVersions.filter(
    (version) =>
      version.type === "MCP" && versionIds.has(version.mcp.connectorVersionId),
  );

  if (versionIds.size === 0) {
    return {
      status: "identity-created",
      workspaceConnectorId: matches[0]?.id,
      workspaceConnectorIds: matches.map((c) => c.id),
      importedMcpToolCount: 0,
      importedMcpToolVersionIds: [],
    };
  }

  if (importedMcp.length === 0) {
    return {
      status: "version-configured",
      workspaceConnectorId: matches[0]?.id,
      workspaceConnectorIds: matches.map((c) => c.id),
      importedMcpToolCount: 0,
      importedMcpToolVersionIds: [],
    };
  }

  return {
    status: "tools-imported",
    workspaceConnectorId: matches[0]?.id,
    workspaceConnectorIds: matches.map((c) => c.id),
    importedMcpToolCount: importedMcp.length,
    importedMcpToolVersionIds: importedMcp.map((version) => version.id),
  };
}
