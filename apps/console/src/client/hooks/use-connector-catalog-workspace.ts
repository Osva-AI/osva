import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { resolveCatalogWorkspaceIntegration } from "../lib/connector-workspace-status";
import type { ConnectorCatalogEntry } from "../lib/osva-connectors-catalog";
import {
  useConnectorsListQuery,
  useToolsCatalogQuery,
  type ConnectorVersionResource,
} from "./use-tools-connectors";
import { workspaceScopedFetch } from "../lib/console-api";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

async function fetchAllConnectorVersions(
  workspaceId: string | undefined,
  connectorIds: readonly string[],
): Promise<ReadonlyMap<string, readonly ConnectorVersionResource[]>> {
  const result = new Map<string, readonly ConnectorVersionResource[]>();
  if (workspaceId === undefined) {
    return result;
  }
  await Promise.all(
    connectorIds.map(async (connectorId) => {
      const response = await workspaceScopedFetch<{
        versions: ConnectorVersionResource[];
      }>(
        workspaceId,
        `/api/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
      );
      result.set(connectorId, response.versions);
    }),
  );
  return result;
}

export function useConnectorCatalogWorkspaceStatus(
  catalogEntry: ConnectorCatalogEntry | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  const connectorsQuery = useConnectorsListQuery();
  const toolsCatalogQuery = useToolsCatalogQuery();

  const connectorIds = useMemo(
    () => connectorsQuery.data?.connectors.map((c) => c.id) ?? [],
    [connectorsQuery.data?.connectors],
  );

  const versionsQuery = useQuery({
    queryKey: [
      "connectors",
      workspaceId,
      "catalog-version-index",
      connectorIds,
    ],
    enabled:
      workspaceId !== undefined &&
      catalogEntry !== undefined &&
      connectorIds.length > 0,
    queryFn: () => fetchAllConnectorVersions(workspaceId, connectorIds),
    staleTime: 60_000,
  });

  return useMemo(() => {
    if (catalogEntry === undefined) {
      return undefined;
    }
    const connectors = connectorsQuery.data?.connectors ?? [];
    const versionsByConnectorId = new Map<string, readonly { id: string }[]>();
    if (versionsQuery.data !== undefined) {
      for (const [connectorId, versions] of versionsQuery.data.entries()) {
        versionsByConnectorId.set(
          connectorId,
          versions.map((v) => ({ id: v.id })),
        );
      }
    }

    const mcpToolVersions =
      toolsCatalogQuery.data?.flatMap((row) =>
        row.versions.filter((v) => v.type === "MCP"),
      ) ?? [];

    return resolveCatalogWorkspaceIntegration({
      catalogConnectorKey: catalogEntry.connectorKey,
      workspaceConnectors: connectors,
      connectorVersionsByConnectorId: versionsByConnectorId,
      mcpToolVersions,
    });
  }, [
    catalogEntry,
    connectorsQuery.data?.connectors,
    toolsCatalogQuery.data,
    versionsQuery.data,
  ]);
}
