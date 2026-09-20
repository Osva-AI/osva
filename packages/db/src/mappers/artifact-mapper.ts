import type { JsonObject } from "@osva/contracts";
import type {
  ArtifactId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";

import { Artifact } from "@osva/domain";

import type { artifacts } from "../schema/artifacts.js";

export type ArtifactRow = typeof artifacts.$inferSelect;
export type ArtifactInsertRow = typeof artifacts.$inferInsert;

export function artifactToRow(artifact: Artifact): ArtifactInsertRow {
  return {
    id: artifact.id,
    workspaceId: artifact.workspaceId,
    name: artifact.name,
    mediaType: artifact.mediaType,
    sizeBytes: artifact.sizeBytes,
    digestSha256: artifact.digest,
    metadata: artifact.metadata as Readonly<Record<string, unknown>>,
    producerRunId: artifact.producerRunId ?? null,
    producerRunAttemptId: artifact.producerRunAttemptId ?? null,
    idempotencyKey: artifact.idempotencyKey ?? null,
    createdAt: artifact.createdAt,
  };
}

export function artifactFromRow(row: ArtifactRow): Artifact {
  return Artifact.create({
    id: row.id as ArtifactId,
    workspaceId: row.workspaceId as WorkspaceId,
    name: row.name,
    mediaType: row.mediaType,
    sizeBytes: row.sizeBytes,
    digest: row.digestSha256,
    metadata: row.metadata as JsonObject,
    producerRunId: (row.producerRunId ?? undefined) as RunId | undefined,
    producerRunAttemptId: (row.producerRunAttemptId ?? undefined) as
      RunAttemptId | undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    createdAt: row.createdAt,
  });
}
