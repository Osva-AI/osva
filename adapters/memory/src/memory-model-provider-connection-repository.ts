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

export class MemoryModelProviderConnectionRepository implements ModelProviderConnectionRepository {
  private readonly connections = new Map<
    ModelProviderConnectionId,
    ModelProviderConnection
  >();
  private readonly versions = new Map<
    ModelProviderConnectionVersionId,
    ModelProviderConnectionVersion
  >();

  async saveConnection(connection: ModelProviderConnection): Promise<void> {
    for (const existing of this.connections.values()) {
      if (
        existing.id !== connection.id &&
        existing.workspaceId === connection.workspaceId &&
        existing.key === connection.key
      ) {
        throw new DuplicateModelProviderConnectionKeyError(
          connection.workspaceId,
          connection.key,
        );
      }
    }

    this.connections.set(connection.id, connection);
  }

  async findConnectionById(
    id: ModelProviderConnectionId,
  ): Promise<ModelProviderConnection | null> {
    return this.connections.get(id) ?? null;
  }

  async findConnectionByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ModelProviderConnectionId,
  ): Promise<ModelProviderConnection | null> {
    const connection = this.connections.get(id);
    if (connection === undefined || connection.workspaceId !== workspaceId) {
      return null;
    }

    return connection;
  }

  async listConnectionsByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<ModelProviderConnection[]> {
    return [...this.connections.values()]
      .filter((connection) => connection.workspaceId === workspaceId)
      .sort(compareConnections);
  }

  async updateConnectionMetadata(
    id: ModelProviderConnectionId,
    metadata: ModelProviderConnectionMetadataUpdate,
  ): Promise<ModelProviderConnection | null> {
    const existing = this.connections.get(id);
    if (existing === undefined) {
      return null;
    }

    const updated = existing.withName(metadata.name, metadata.updatedAt);
    this.connections.set(id, updated);
    return updated;
  }

  async saveConnectionVersion(
    version: ModelProviderConnectionVersion,
  ): Promise<void> {
    const existing = this.versions.get(version.id);
    if (existing !== undefined && existing !== version) {
      throw new DomainInvariantError(
        `ModelProviderConnectionVersion '${version.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    this.versions.set(version.id, version);
  }

  async appendConnectionVersion(
    input: AppendModelProviderConnectionVersionInput,
  ): Promise<ModelProviderConnectionVersion> {
    const connection = this.connections.get(input.connectionId);
    if (connection === undefined) {
      throw new ModelProviderConnectionNotFoundError(input.connectionId);
    }

    const nextVersion =
      [...this.versions.values()]
        .filter((version) => version.connectionId === input.connectionId)
        .reduce((max, version) => Math.max(max, version.version), 0) + 1;

    const version = ModelProviderConnectionVersion.create({
      id: input.id,
      connectionId: input.connectionId,
      version: nextVersion,
      endpoint: input.endpoint,
      credentialRef: input.credentialRef,
      createdAt: input.createdAt,
    });

    this.versions.set(version.id, version);
    return version;
  }

  async findConnectionVersionById(
    id: ModelProviderConnectionVersionId,
  ): Promise<ModelProviderConnectionVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async findConnectionVersionByConnectionAndId(
    connectionId: ModelProviderConnectionId,
    connectionVersionId: ModelProviderConnectionVersionId,
  ): Promise<ModelProviderConnectionVersion | null> {
    const version = this.versions.get(connectionVersionId);
    if (version === undefined || version.connectionId !== connectionId) {
      return null;
    }

    return version;
  }

  async listConnectionVersions(
    connectionId: ModelProviderConnectionId,
  ): Promise<ModelProviderConnectionVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.connectionId === connectionId)
      .sort((left, right) => left.version - right.version);
  }
}

function compareConnections(
  left: ModelProviderConnection,
  right: ModelProviderConnection,
): number {
  const createdAtDelta = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return left.id.localeCompare(right.id);
}
