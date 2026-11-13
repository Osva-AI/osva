import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  CONNECTOR_CATALOG,
  type ConnectorCatalogEntry,
} from "../lib/osva-connectors-catalog";
import {
  resolveCatalogWorkspaceIntegration,
  type CatalogWorkspaceIntegrationStatus,
} from "../lib/connector-workspace-status";
import {
  useConnectorsListQuery,
  useToolsCatalogQuery,
  type ConnectorVersionResource,
} from "./use-tools-connectors";
import { workspaceScopedFetch } from "../lib/console-api";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

async function fetchConnectorVersions(
  workspaceId: string,
  connectorId: string,
): Promise<readonly ConnectorVersionResource[]> {
  const response = await workspaceScopedFetch<{
    versions: ConnectorVersionResource[];
  }>(
    workspaceId,
    `/api/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
  );
  return response.versions;
}

export function useConnectorCatalogWorkspaceIndex(): {
  readonly statusByConnectorId: ReadonlyMap<
    string,
    CatalogWorkspaceIntegrationStatus
  >;
  readonly isLoading: boolean;
} {
  const workspaceId = useWorkspaceQueryScope();
  const connectorsQuery = useConnectorsListQuery();
  const toolsCatalogQuery = useToolsCatalogQuery();

  const catalogKeys = useMemo(
    () => new Set(CONNECTOR_CATALOG.map((e) => e.connectorKey)),
    [],
  );

  const matchedConnectors = useMemo(() => {
    return (
      connectorsQuery.data?.connectors.filter((c) => catalogKeys.has(c.key)) ??
      []
    );
  }, [catalogKeys, connectorsQuery.data?.connectors]);

  const versionsQuery = useQuery({
    queryKey: [
      "connectors",
      workspaceId,
      "catalog-workspace-index",
      matchedConnectors.map((c) => c.id),
    ],
    enabled: workspaceId !== undefined && matchedConnectors.length > 0,
    queryFn: async () => {
      const map = new Map<string, readonly ConnectorVersionResource[]>();
      await Promise.all(
        matchedConnectors.map(async (connector) => {
          const versions = await fetchConnectorVersions(
            workspaceId!,
            connector.id,
          );
          map.set(connector.id, versions);
        }),
      );
      return map;
    },
    staleTime: 60_000,
  });

  const statusByConnectorId = useMemo(() => {
    const result = new Map<string, CatalogWorkspaceIntegrationStatus>();
    const connectors = connectorsQuery.data?.connectors ?? [];
    const mcpToolVersions =
      toolsCatalogQuery.data?.flatMap((row) =>
        row.versions.filter((v) => v.type === "MCP"),
      ) ?? [];

    for (const entry of CONNECTOR_CATALOG) {
      const versionsByConnectorId = new Map<
        string,
        readonly { id: string }[]
      >();
      if (versionsQuery.data !== undefined) {
        for (const [connectorId, versions] of versionsQuery.data.entries()) {
          versionsByConnectorId.set(
            connectorId,
            versions.map((v) => ({ id: v.id })),
          );
        }
      }

      const resolved = resolveCatalogWorkspaceIntegration({
        catalogConnectorKey: entry.connectorKey,
        workspaceConnectors: connectors,
        connectorVersionsByConnectorId: versionsByConnectorId,
        mcpToolVersions,
      });
      result.set(entry.connectorId, resolved.status);
    }
    return result;
  }, [
    connectorsQuery.data?.connectors,
    toolsCatalogQuery.data,
    versionsQuery.data,
  ]);

  const isLoading =
    connectorsQuery.isLoading ||
    toolsCatalogQuery.isLoading ||
    (matchedConnectors.length > 0 && versionsQuery.isLoading);

  return { statusByConnectorId, isLoading };
}

export function workspaceStatusForEntry(
  entry: ConnectorCatalogEntry,
  statusByConnectorId: ReadonlyMap<string, CatalogWorkspaceIntegrationStatus>,
): CatalogWorkspaceIntegrationStatus {
  return statusByConnectorId.get(entry.connectorId) ?? "catalog-only";
}
