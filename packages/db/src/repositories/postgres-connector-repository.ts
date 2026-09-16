import type { ConnectorId, ConnectorVersionId } from "@osva/contracts";
import {
  ConnectorNotFoundError,
  ConnectorVersion,
  DomainInvariantError,
  DuplicateConnectorKeyError,
  type AppendConnectorVersionInput,
  type Connector,
  type ConnectorMetadataUpdate,
  type ConnectorRepository,
} from "@osva/domain";
import { asc, eq, max } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  connectorFromRow,
  connectorToRow,
} from "../mappers/connector-mapper.js";
import {
  connectorVersionFromRow,
  connectorVersionToRow,
  isSameConnectorVersion,
} from "../mappers/connector-version-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { connectorVersions } from "../schema/connector-versions.js";
import { connectors } from "../schema/connectors.js";

export class PostgresConnectorRepository implements ConnectorRepository {
  constructor(private readonly database: Database) {}

  async saveConnector(connector: Connector): Promise<void> {
    const row = connectorToRow(connector);

    try {
      await this.database.db
        .insert(connectors)
        .values(row)
        .onConflictDoUpdate({
          target: connectors.id,
          set: {
            workspaceId: row.workspaceId,
            key: row.key,
            name: row.name,
            description: row.description,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) === "connectors_workspace_id_key_unique"
      ) {
        throw new DuplicateConnectorKeyError(
          connector.workspaceId,
          connector.key,
        );
      }

      throw mapDatabaseError(error, {
        connectors_workspace_id_key_unique: `Connector key '${connector.key}' already exists in workspace '${connector.workspaceId}'.`,
      });
    }
  }

  async findConnectorById(id: ConnectorId): Promise<Connector | null> {
    const [row] = await this.database.db
      .select()
      .from(connectors)
      .where(eq(connectors.id, id))
      .limit(1);

    return row === undefined ? null : connectorFromRow(row);
  }

  async listConnectors(): Promise<Connector[]> {
    const rows = await this.database.db
      .select()
      .from(connectors)
      .orderBy(asc(connectors.createdAt), asc(connectors.id));

    return rows.map(connectorFromRow);
  }

  async updateConnectorMetadata(
    id: ConnectorId,
    metadata: ConnectorMetadataUpdate,
  ): Promise<Connector | null> {
    const existing = await this.findConnectorById(id);
    if (existing === null) {
      return null;
    }

    const updated = existing.withMetadata(metadata);

    await this.database.db
      .update(connectors)
      .set({
        name: updated.name,
        description: updated.description ?? null,
        updatedAt: updated.updatedAt,
      })
      .where(eq(connectors.id, id));

    return updated;
  }

  async saveConnectorVersion(version: ConnectorVersion): Promise<void> {
    const existing = await this.findConnectorVersionById(version.id);

    if (existing) {
      if (isSameConnectorVersion(existing, version)) {
        return;
      }

      throw new DomainInvariantError(
        `ConnectorVersion '${version.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    try {
      await this.database.db
        .insert(connectorVersions)
        .values(connectorVersionToRow(version));
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        const constraint = postgresConstraintName(error);

        if (
          constraint === "connector_versions_id_pk" ||
          constraint === "connector_versions_pkey"
        ) {
          const stored = await this.findConnectorVersionById(version.id);
          if (stored && isSameConnectorVersion(stored, version)) {
            return;
          }

          throw new DomainInvariantError(
            `ConnectorVersion '${version.id}' is immutable and cannot be replaced with different content.`,
          );
        }

        if (constraint === "connector_versions_connector_id_version_unique") {
          throw new DomainInvariantError(
            `ConnectorVersion already exists for connector '${version.connectorId}' version ${String(version.version)}.`,
          );
        }
      }

      throw mapDatabaseError(error, {
        connector_versions_connector_id_version_unique: `ConnectorVersion already exists for connector '${version.connectorId}' version ${String(version.version)}.`,
      });
    }
  }

  async appendConnectorVersion(
    input: AppendConnectorVersionInput,
  ): Promise<ConnectorVersion> {
    return this.database.db.transaction(async (tx) => {
      const [connectorRow] = await tx
        .select()
        .from(connectors)
        .where(eq(connectors.id, input.connectorId))
        .for("update")
        .limit(1);

      if (connectorRow === undefined) {
        throw new ConnectorNotFoundError(input.connectorId);
      }

      const [aggregate] = await tx
        .select({ maxVersion: max(connectorVersions.version) })
        .from(connectorVersions)
        .where(eq(connectorVersions.connectorId, input.connectorId));

      const nextVersion = (aggregate?.maxVersion ?? 0) + 1;
      const version = ConnectorVersion.create({
        id: input.id,
        connectorId: input.connectorId,
        version: nextVersion,
        kind: input.kind,
        transport: input.transport,
        transportConfig: input.transportConfig,
        auth: input.auth,
        createdAt: input.createdAt,
      });

      try {
        await tx
          .insert(connectorVersions)
          .values(connectorVersionToRow(version));
      } catch (error) {
        throw mapDatabaseError(error, {
          connector_versions_connector_id_version_unique: `ConnectorVersion already exists for connector '${input.connectorId}' version ${String(nextVersion)}.`,
        });
      }

      return version;
    });
  }

  async findConnectorVersionById(
    id: ConnectorVersionId,
  ): Promise<ConnectorVersion | null> {
    const [row] = await this.database.db
      .select()
      .from(connectorVersions)
      .where(eq(connectorVersions.id, id))
      .limit(1);

    return row === undefined ? null : connectorVersionFromRow(row);
  }

  async listConnectorVersions(
    connectorId: ConnectorId,
  ): Promise<ConnectorVersion[]> {
    const rows = await this.database.db
      .select()
      .from(connectorVersions)
      .where(eq(connectorVersions.connectorId, connectorId))
      .orderBy(asc(connectorVersions.version));

    return rows.map(connectorVersionFromRow);
  }
}
