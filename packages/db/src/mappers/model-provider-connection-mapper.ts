import type {
  ModelProvider,
  ModelProviderConnectionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { ModelProviderConnection } from "@osva/domain";

import type { modelProviderConnections } from "../schema/model-provider-connections.js";
import { toDomainDate } from "./timestamps.js";

type ModelProviderConnectionRow = typeof modelProviderConnections.$inferSelect;

export function modelProviderConnectionToRow(
  connection: ModelProviderConnection,
) {
  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    key: connection.key,
    name: connection.name,
    provider: connection.provider,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export function modelProviderConnectionFromRow(
  row: ModelProviderConnectionRow,
): ModelProviderConnection {
  return ModelProviderConnection.create({
    id: row.id as ModelProviderConnectionId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    provider: row.provider as ModelProvider,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}
