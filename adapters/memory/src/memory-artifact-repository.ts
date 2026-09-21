import type { ArtifactId, WorkspaceId } from "@osva/contracts";
import {
  Artifact,
  type ArtifactRepository,
  type ListArtifactsQuery,
  type ListArtifactsResult,
} from "@osva/domain";

export class MemoryArtifactRepository implements ArtifactRepository {
  private readonly artifacts = new Map<ArtifactId, Artifact>();
  private readonly idempotency = new Map<string, ArtifactId>();

  async save(artifact: Artifact): Promise<void> {
    if (this.artifacts.has(artifact.id)) {
      throw new Error(`Artifact ${artifact.id} already exists.`);
    }

    this.artifacts.set(artifact.id, artifact);
    if (artifact.idempotencyKey !== undefined) {
      const key = idempotencyMapKey(
        artifact.workspaceId,
        artifact.idempotencyKey,
      );
      if (this.idempotency.has(key)) {
        throw new Error(
          "Artifact idempotency key already exists in workspace.",
        );
      }
      this.idempotency.set(key, artifact.id);
    }
  }

  async findById(artifactId: ArtifactId): Promise<Artifact | null> {
    return this.artifacts.get(artifactId) ?? null;
  }

  async findByWorkspaceAndId(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
  ): Promise<Artifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (artifact === undefined || artifact.workspaceId !== workspaceId) {
      return null;
    }

    return artifact;
  }

  async findByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Artifact | null> {
    const artifactId = this.idempotency.get(
      idempotencyMapKey(workspaceId, idempotencyKey),
    );
    return artifactId === undefined
      ? null
      : (this.artifacts.get(artifactId) ?? null);
  }

  async list(query: ListArtifactsQuery): Promise<ListArtifactsResult> {
    let rows = [...this.artifacts.values()].filter(
      (artifact) => artifact.workspaceId === query.workspaceId,
    );

    if (query.runId !== undefined) {
      rows = rows.filter((artifact) => artifact.producerRunId === query.runId);
    }

    if (query.runAttemptId !== undefined) {
      rows = rows.filter(
        (artifact) => artifact.producerRunAttemptId === query.runAttemptId,
      );
    }

    rows.sort((left, right) => {
      const createdAtCompare =
        right.createdAt.getTime() - left.createdAt.getTime();
      if (createdAtCompare !== 0) {
        return createdAtCompare;
      }

      return right.id.localeCompare(left.id);
    });

    if (query.cursor !== undefined) {
      rows = rows.filter((artifact) => {
        if (artifact.createdAt < query.cursor!.createdAt) {
          return true;
        }

        if (artifact.createdAt > query.cursor!.createdAt) {
          return false;
        }

        return artifact.id < query.cursor!.id;
      });
    }

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      artifacts: page,
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : undefined,
    };
  }
}

function idempotencyMapKey(
  workspaceId: WorkspaceId,
  idempotencyKey: string,
): string {
  return `${workspaceId}\u0000${idempotencyKey}`;
}
