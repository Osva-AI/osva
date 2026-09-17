import type { ConnectorId, ConnectorVersionId } from "@osva/contracts";
import {
  Connector,
  ConnectorNotFoundError,
  ConnectorVersion,
  DomainInvariantError,
  DuplicateConnectorKeyError,
  type AppendConnectorVersionInput,
  type ConnectorMetadataUpdate,
  type ConnectorRepository,
} from "@osva/domain";

export class MemoryConnectorRepository implements ConnectorRepository {
  private readonly connectors = new Map<ConnectorId, Connector>();
  private readonly versions = new Map<ConnectorVersionId, ConnectorVersion>();

  async saveConnector(connector: Connector): Promise<void> {
    for (const existing of this.connectors.values()) {
      if (
        existing.id !== connector.id &&
        existing.workspaceId === connector.workspaceId &&
        existing.key === connector.key
      ) {
        throw new DuplicateConnectorKeyError(
          connector.workspaceId,
          connector.key,
        );
      }
    }

    this.connectors.set(connector.id, connector);
  }

  async findConnectorById(id: ConnectorId): Promise<Connector | null> {
    return this.connectors.get(id) ?? null;
  }

  async listConnectors(): Promise<Connector[]> {
    return [...this.connectors.values()].sort(compareConnectors);
  }

  async updateConnectorMetadata(
    id: ConnectorId,
    metadata: ConnectorMetadataUpdate,
  ): Promise<Connector | null> {
    const existing = this.connectors.get(id);
    if (existing === undefined) {
      return null;
    }

    const updated = existing.withMetadata(metadata);
    this.connectors.set(id, updated);
    return updated;
  }

  async saveConnectorVersion(version: ConnectorVersion): Promise<void> {
    const existing = this.versions.get(version.id);

    if (existing && !isSameConnectorVersion(existing, version)) {
      throw new DomainInvariantError(
        `ConnectorVersion '${version.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    if (!existing) {
      for (const stored of this.versions.values()) {
        if (
          stored.connectorId === version.connectorId &&
          stored.version === version.version
        ) {
          throw new DomainInvariantError(
            `ConnectorVersion already exists for connector '${version.connectorId}' version ${String(version.version)}.`,
          );
        }
      }
    }

    this.versions.set(version.id, existing ?? version);
  }

  async appendConnectorVersion(
    input: AppendConnectorVersionInput,
  ): Promise<ConnectorVersion> {
    if (!this.connectors.has(input.connectorId)) {
      throw new ConnectorNotFoundError(input.connectorId);
    }

    let maxVersion = 0;
    for (const stored of this.versions.values()) {
      if (
        stored.connectorId === input.connectorId &&
        stored.version > maxVersion
      ) {
        maxVersion = stored.version;
      }
    }

    const version = ConnectorVersion.create({
      id: input.id,
      connectorId: input.connectorId,
      version: maxVersion + 1,
      kind: input.kind,
      transport: input.transport,
      transportConfig: input.transportConfig,
      auth: input.auth,
      createdAt: input.createdAt,
    });

    await this.saveConnectorVersion(version);
    return version;
  }

  async findConnectorVersionById(
    id: ConnectorVersionId,
  ): Promise<ConnectorVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listConnectorVersions(
    connectorId: ConnectorId,
  ): Promise<ConnectorVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.connectorId === connectorId)
      .sort((left, right) => left.version - right.version);
  }
}

function compareConnectors(left: Connector, right: Connector): number {
  const createdAtDelta = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return left.id.localeCompare(right.id);
}

function isSameConnectorVersion(
  left: ConnectorVersion,
  right: ConnectorVersion,
): boolean {
  return (
    left.id === right.id &&
    left.connectorId === right.connectorId &&
    left.version === right.version &&
    left.kind === right.kind &&
    left.transport === right.transport &&
    JSON.stringify(left.transportConfig) ===
      JSON.stringify(right.transportConfig) &&
    JSON.stringify(left.auth) === JSON.stringify(right.auth) &&
    left.createdAt.getTime() === right.createdAt.getTime()
  );
}
