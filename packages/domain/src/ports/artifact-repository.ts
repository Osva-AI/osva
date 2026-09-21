import type {
  ArtifactId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";

import type { Artifact } from "../artifact.js";

export const DEFAULT_ARTIFACT_LIST_LIMIT = 50;
export const MAX_ARTIFACT_LIST_LIMIT = 100;

export interface ArtifactListCursor {
  readonly createdAt: Date;
  readonly id: ArtifactId;
}

export interface ListArtifactsQuery {
  readonly workspaceId: WorkspaceId;
  readonly runId?: RunId;
  readonly runAttemptId?: RunAttemptId;
  readonly limit: number;
  readonly cursor?: ArtifactListCursor;
}

export interface ListArtifactsResult {
  readonly artifacts: readonly Artifact[];
  readonly nextCursor?: ArtifactListCursor;
}

export interface ArtifactRepository {
  save(artifact: Artifact): Promise<void>;
  findById(artifactId: ArtifactId): Promise<Artifact | null>;
  findByWorkspaceAndId(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
  ): Promise<Artifact | null>;
  findByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Artifact | null>;
  list(query: ListArtifactsQuery): Promise<ListArtifactsResult>;
}
