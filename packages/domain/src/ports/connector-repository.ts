import type {
  ConnectorAuthConfig,
  ConnectorId,
  ConnectorKind,
  ConnectorTransport,
  ConnectorTransportConfig,
  ConnectorVersionId,
} from "@osva/contracts";

import type { Connector } from "../connector.js";
import type { ConnectorVersion } from "../connector-version.js";

export interface ConnectorMetadataUpdate {
  readonly name: string;
  readonly description?: string;
  readonly updatedAt: Date;
}

export interface AppendConnectorVersionInput {
  readonly id: ConnectorVersionId;
  readonly connectorId: ConnectorId;
  readonly kind: ConnectorKind;
  readonly transport: ConnectorTransport;
  readonly transportConfig: ConnectorTransportConfig;
  readonly auth?: ConnectorAuthConfig;
  readonly createdAt: Date;
}

export interface ConnectorRepository {
  saveConnector(connector: Connector): Promise<void>;
  findConnectorById(id: ConnectorId): Promise<Connector | null>;
  listConnectors(): Promise<Connector[]>;
  updateConnectorMetadata(
    id: ConnectorId,
    metadata: ConnectorMetadataUpdate,
  ): Promise<Connector | null>;
  saveConnectorVersion(version: ConnectorVersion): Promise<void>;
  appendConnectorVersion(
    input: AppendConnectorVersionInput,
  ): Promise<ConnectorVersion>;
  findConnectorVersionById(
    id: ConnectorVersionId,
  ): Promise<ConnectorVersion | null>;
  listConnectorVersions(connectorId: ConnectorId): Promise<ConnectorVersion[]>;
}
