import type { ConnectorId, WorkspaceId } from "@osva/contracts";
import { Connector } from "@osva/domain";

import type { connectors } from "../schema/connectors.js";
import { toDomainDate } from "./timestamps.js";

type ConnectorRow = typeof connectors.$inferSelect;

export function connectorToRow(connector: Connector) {
  return {
    id: connector.id,
    workspaceId: connector.workspaceId,
    key: connector.key,
    name: connector.name,
    description: connector.description ?? null,
    createdAt: connector.createdAt,
    updatedAt: connector.updatedAt,
  };
}

export function connectorFromRow(row: ConnectorRow): Connector {
  return Connector.create({
    id: row.id as ConnectorId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}
