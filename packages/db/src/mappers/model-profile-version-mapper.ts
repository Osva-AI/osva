import type {
  ModelProfileId,
  ModelProfileVersionId,
  ModelProvider,
} from "@osva/contracts";
import { ModelProfileVersion } from "@osva/domain";

import type { modelProfileVersions } from "../schema/model-profile-versions.js";
import { toDomainDate } from "./timestamps.js";

type ModelProfileVersionRow = typeof modelProfileVersions.$inferSelect;

export function modelProfileVersionToRow(version: ModelProfileVersion) {
  return {
    id: version.id,
    modelProfileId: version.modelProfileId,
    version: version.version,
    provider: version.provider,
    model: version.model,
    pricing: version.pricing ?? null,
    createdAt: version.createdAt,
  };
}

export function modelProfileVersionFromRow(
  row: ModelProfileVersionRow,
): ModelProfileVersion {
  return ModelProfileVersion.create({
    id: row.id as ModelProfileVersionId,
    modelProfileId: row.modelProfileId as ModelProfileId,
    version: row.version,
    provider: row.provider as ModelProvider,
    model: row.model,
    pricing: row.pricing ?? undefined,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function isSameModelProfileVersion(
  left: ModelProfileVersion,
  right: ModelProfileVersion,
): boolean {
  return (
    left.id === right.id &&
    left.modelProfileId === right.modelProfileId &&
    left.version === right.version &&
    left.provider === right.provider &&
    left.model === right.model &&
    JSON.stringify(left.pricing ?? null) ===
      JSON.stringify(right.pricing ?? null) &&
    left.createdAt.getTime() === right.createdAt.getTime()
  );
}
