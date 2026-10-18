import type {
  ModelProviderConnectionId,
  ModelProviderConnectionVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  DomainInvariantError,
  DuplicateModelProviderConnectionKeyError,
  ModelProviderConnection,
  ModelProviderConnectionNotFoundError,
  ModelProviderConnectionVersion,
  type AppendModelProviderConnectionVersionInput,
  type ModelProviderConnectionMetadataUpdate,
  type ModelProviderConnectionRepository,
} from "@osva/domain";
import { and, asc, eq, max } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  modelProviderConnectionFromRow,
  modelProviderConnectionToRow,
} from "../mappers/model-provider-connection-mapper.js";
import {
  isSameModelProviderConnectionVersion,
  modelProviderConnectionVersionFromRow,
  modelProviderConnectionVersionToRow,
} from "../mappers/model-provider-connection-version-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { modelProviderConnectionVersions } from "../schema/model-provider-connection-versions.js";
import { modelProviderConnections } from "../schema/model-provider-connections.js";

export class PostgresModelProviderConnectionRepository implements ModelProviderConnectionRepository {
  constructor(private readonly database: Database) {}

  async saveConnection(connection: ModelProviderConnection): Promise<void> {
    const row = modelProviderConnectionToRow(connection);

    try {
      await this.database.db
        .insert(modelProviderConnections)
        .values(row)
        .onConflictDoUpdate({
          target: modelProviderConnections.id,
          set: {
            workspaceId: row.workspaceId,
            key: row.key,
            name: row.name,
            provider: row.provider,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) ===
          "model_provider_connections_workspace_id_key_unique"
      ) {
        throw new DuplicateModelProviderConnectionKeyError(
          connection.workspaceId,
          connection.key,
        );
      }

      throw mapDatabaseError(error, {
        model_provider_connections_workspace_id_key_unique: `Model provider connection key '${connection.key}' already exists in workspace '${connection.workspaceId}'.`,
      });
    }
  }

  async findConnectionById(
    id: ModelProviderConnectionId,
  ): Promise<ModelProviderConnection | null> {
    const [row] = await this.database.db
      .select()
      .from(modelProviderConnections)
      .where(eq(modelProviderConnections.id, id))
      .limit(1);

    return row === undefined ? null : modelProviderConnectionFromRow(row);
  }

  async findConnectionByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ModelProviderConnectionId,
  ): Promise<ModelProviderConnection | null> {
    const [row] = await this.database.db
      .select()
      .from(modelProviderConnections)
      .where(
        and(
          eq(modelProviderConnections.id, id),
          eq(modelProviderConnections.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return row === undefined ? null : modelProviderConnectionFromRow(row);
  }

  async listConnectionsByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<ModelProviderConnection[]> {
    const rows = await this.database.db
      .select()
      .from(modelProviderConnections)
      .where(eq(modelProviderConnections.workspaceId, workspaceId))
      .orderBy(
        asc(modelProviderConnections.createdAt),
        asc(modelProviderConnections.id),
      );

    return rows.map(modelProviderConnectionFromRow);
  }

  async updateConnectionMetadata(
    id: ModelProviderConnectionId,
    metadata: ModelProviderConnectionMetadataUpdate,
  ): Promise<ModelProviderConnection | null> {
    const existing = await this.findConnectionById(id);
    if (existing === null) {
      return null;
    }

    const updated = existing.withName(metadata.name, metadata.updatedAt);

    await this.database.db
      .update(modelProviderConnections)
      .set({
        name: updated.name,
        updatedAt: updated.updatedAt,
      })
      .where(eq(modelProviderConnections.id, id));

    return updated;
  }

  async saveConnectionVersion(
    version: ModelProviderConnectionVersion,
  ): Promise<void> {
    const existing = await this.findConnectionVersionById(version.id);

    if (existing) {
      if (isSameModelProviderConnectionVersion(existing, version)) {
        return;
      }

      throw new DomainInvariantError(
        `ModelProviderConnectionVersion '${version.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    try {
      await this.database.db
        .insert(modelProviderConnectionVersions)
        .values(modelProviderConnectionVersionToRow(version));
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        const constraint = postgresConstraintName(error);

        if (
          constraint === "model_provider_connection_versions_id_pk" ||
          constraint === "model_provider_connection_versions_pkey"
        ) {
          const stored = await this.findConnectionVersionById(version.id);
          if (stored && isSameModelProviderConnectionVersion(stored, version)) {
            return;
          }

          throw new DomainInvariantError(
            `ModelProviderConnectionVersion '${version.id}' is immutable and cannot be replaced with different content.`,
          );
        }

        if (
          constraint ===
          "model_provider_connection_versions_connection_id_version_unique"
        ) {
          throw new DomainInvariantError(
            `ModelProviderConnectionVersion already exists for connection '${version.connectionId}' version ${String(version.version)}.`,
          );
        }
      }

      throw mapDatabaseError(error, {
        model_provider_connection_versions_connection_id_version_unique: `ModelProviderConnectionVersion already exists for connection '${version.connectionId}' version ${String(version.version)}.`,
      });
    }
  }

  async appendConnectionVersion(
    input: AppendModelProviderConnectionVersionInput,
  ): Promise<ModelProviderConnectionVersion> {
    return this.database.db.transaction(async (tx) => {
      const [connectionRow] = await tx
        .select()
        .from(modelProviderConnections)
        .where(eq(modelProviderConnections.id, input.connectionId))
        .for("update")
        .limit(1);

      if (connectionRow === undefined) {
        throw new ModelProviderConnectionNotFoundError(input.connectionId);
      }

      const [aggregate] = await tx
        .select({ maxVersion: max(modelProviderConnectionVersions.version) })
        .from(modelProviderConnectionVersions)
        .where(
          eq(modelProviderConnectionVersions.connectionId, input.connectionId),
        );

      const nextVersion = (aggregate?.maxVersion ?? 0) + 1;
      const version = ModelProviderConnectionVersion.create({
        id: input.id,
        connectionId: input.connectionId,
        version: nextVersion,
        endpoint: input.endpoint,
        credentialRef: input.credentialRef,
        createdAt: input.createdAt,
      });

      try {
        await tx
          .insert(modelProviderConnectionVersions)
          .values(modelProviderConnectionVersionToRow(version));
      } catch (error) {
        throw mapDatabaseError(error, {
          model_provider_connection_versions_connection_id_version_unique: `ModelProviderConnectionVersion already exists for connection '${input.connectionId}' version ${String(nextVersion)}.`,
        });
      }

      return version;
    });
  }

  async findConnectionVersionById(
    id: ModelProviderConnectionVersionId,
  ): Promise<ModelProviderConnectionVersion | null> {
    const [row] = await this.database.db
      .select()
      .from(modelProviderConnectionVersions)
      .where(eq(modelProviderConnectionVersions.id, id))
      .limit(1);

    return row === undefined
      ? null
      : modelProviderConnectionVersionFromRow(row);
  }

  async findConnectionVersionByConnectionAndId(
    connectionId: ModelProviderConnectionId,
    connectionVersionId: ModelProviderConnectionVersionId,
  ): Promise<ModelProviderConnectionVersion | null> {
    const [row] = await this.database.db
      .select()
      .from(modelProviderConnectionVersions)
      .where(
        and(
          eq(modelProviderConnectionVersions.connectionId, connectionId),
          eq(modelProviderConnectionVersions.id, connectionVersionId),
        ),
      )
      .limit(1);

    return row === undefined
      ? null
      : modelProviderConnectionVersionFromRow(row);
  }

  async listConnectionVersions(
    connectionId: ModelProviderConnectionId,
  ): Promise<ModelProviderConnectionVersion[]> {
    const rows = await this.database.db
      .select()
      .from(modelProviderConnectionVersions)
      .where(eq(modelProviderConnectionVersions.connectionId, connectionId))
      .orderBy(asc(modelProviderConnectionVersions.version));

    return rows.map(modelProviderConnectionVersionFromRow);
  }
}
