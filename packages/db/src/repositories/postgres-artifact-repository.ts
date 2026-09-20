import type { ArtifactId, WorkspaceId } from "@osva/contracts";
import {
  Artifact,
  type ArtifactRepository,
  type ListArtifactsQuery,
  type ListArtifactsResult,
} from "@osva/domain";
import { and, desc, eq, lt, or } from "drizzle-orm";

import type { Database } from "../database.js";
import { artifactFromRow, artifactToRow } from "../mappers/artifact-mapper.js";
import { mapDatabaseError } from "../postgres-errors.js";
import { artifacts } from "../schema/artifacts.js";

export class PostgresArtifactRepository implements ArtifactRepository {
  constructor(private readonly database: Database) {}

  async save(artifact: Artifact): Promise<void> {
    const row = artifactToRow(artifact);

    try {
      await this.database.db.insert(artifacts).values(row);
    } catch (error) {
      throw mapDatabaseError(error, {
        artifacts_workspace_id_idempotency_key_unique:
          "Artifact idempotency key already exists in workspace.",
      });
    }
  }

  async findById(artifactId: ArtifactId): Promise<Artifact | null> {
    const [row] = await this.database.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, artifactId))
      .limit(1);

    return row === undefined ? null : artifactFromRow(row);
  }

  async findByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Artifact | null> {
    const [row] = await this.database.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, workspaceId),
          eq(artifacts.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return row === undefined ? null : artifactFromRow(row);
  }

  async list(query: ListArtifactsQuery): Promise<ListArtifactsResult> {
    const conditions = [eq(artifacts.workspaceId, query.workspaceId)];

    if (query.runId !== undefined) {
      conditions.push(eq(artifacts.producerRunId, query.runId));
    }

    if (query.runAttemptId !== undefined) {
      conditions.push(eq(artifacts.producerRunAttemptId, query.runAttemptId));
    }

    if (query.cursor !== undefined) {
      const cursorCondition = or(
        lt(artifacts.createdAt, query.cursor.createdAt),
        and(
          eq(artifacts.createdAt, query.cursor.createdAt),
          lt(artifacts.id, query.cursor.id),
        ),
      );
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(artifacts)
      .where(and(...conditions))
      .orderBy(desc(artifacts.createdAt), desc(artifacts.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const mapped = page.map(artifactFromRow);
    const last = mapped[mapped.length - 1];

    return {
      artifacts: mapped,
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : undefined,
    };
  }
}
