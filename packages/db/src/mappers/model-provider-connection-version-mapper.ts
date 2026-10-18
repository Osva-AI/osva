import type {
  ModelProviderConnectionId,
  ModelProviderConnectionVersionId,
} from "@osva-ai/contracts";
import { ModelProviderConnectionVersion } from "@osva/domain";

import type { modelProviderConnectionVersions } from "../schema/model-provider-connection-versions.js";
import { toDomainDate } from "./timestamps.js";

type ModelProviderConnectionVersionRow =
  typeof modelProviderConnectionVersions.$inferSelect;

export function modelProviderConnectionVersionToRow(
  version: ModelProviderConnectionVersion,
) {
  return {
    id: version.id,
    connectionId: version.connectionId,
    version: version.version,
    endpoint: version.endpoint ?? null,
    credentialRef: version.credentialRef ?? null,
    createdAt: version.createdAt,
  };
}

export function modelProviderConnectionVersionFromRow(
  row: ModelProviderConnectionVersionRow,
): ModelProviderConnectionVersion {
  return ModelProviderConnectionVersion.create({
    id: row.id as ModelProviderConnectionVersionId,
    connectionId: row.connectionId as ModelProviderConnectionId,
    version: row.version,
    endpoint: row.endpoint ?? undefined,
    credentialRef: row.credentialRef ?? undefined,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function isSameModelProviderConnectionVersion(
  left: ModelProviderConnectionVersion,
  right: ModelProviderConnectionVersion,
): boolean {
  return (
    left.id === right.id &&
    left.connectionId === right.connectionId &&
    left.version === right.version &&
    JSON.stringify(left.endpoint ?? null) ===
      JSON.stringify(right.endpoint ?? null) &&
    JSON.stringify(left.credentialRef ?? null) ===
      JSON.stringify(right.credentialRef ?? null) &&
    left.createdAt.getTime() === right.createdAt.getTime()
  );
}
