import type { ModelProfileId, WorkspaceId } from "@osva/contracts";
import { ModelProfile } from "@osva/domain";

import type { modelProfiles } from "../schema/model-profiles.js";
import { toDomainDate } from "./timestamps.js";

type ModelProfileRow = typeof modelProfiles.$inferSelect;

export function modelProfileToRow(profile: ModelProfile) {
  return {
    id: profile.id,
    workspaceId: profile.workspaceId,
    key: profile.key,
    name: profile.name,
    createdAt: profile.createdAt,
  };
}

export function modelProfileFromRow(row: ModelProfileRow): ModelProfile {
  return ModelProfile.create({
    id: row.id as ModelProfileId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    createdAt: toDomainDate(row.createdAt),
  });
}
