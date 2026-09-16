import type { ConnectorId, ConnectorVersionId, WorkspaceId } from "./ids.js";
import type { JsonSchemaRecord } from "./json-schema.js";
import type {
  ConnectorAuthConfig,
  ConnectorKind,
  ConnectorTransport,
  ConnectorTransportConfig,
} from "./connector.js";

export interface CreateConnectorRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface UpdateConnectorRequestV1 {
  readonly name: string;
  readonly description?: string;
}

export interface CreateConnectorVersionRequestV1 {
  readonly kind: ConnectorKind;
  readonly transport: ConnectorTransport;
  readonly transportConfig: ConnectorTransportConfig;
  readonly auth?: ConnectorAuthConfig;
}

export interface ConnectorResourceV1 {
  readonly id: ConnectorId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConnectorListResourceV1 {
  readonly connectors: readonly ConnectorResourceV1[];
}

export interface ConnectorVersionResourceV1 {
  readonly id: ConnectorVersionId;
  readonly connectorId: ConnectorId;
  readonly version: number;
  readonly kind: ConnectorKind;
  readonly transport: ConnectorTransport;
  readonly transportConfig: ConnectorTransportConfig;
  readonly auth?: ConnectorAuthConfig;
  readonly createdAt: string;
}

export interface ConnectorVersionListResourceV1 {
  readonly versions: readonly ConnectorVersionResourceV1[];
}

export interface DiscoveredMcpToolV1 {
  readonly remoteToolName: string;
  readonly description?: string;
  readonly inputSchema: JsonSchemaRecord;
}

export interface DiscoverConnectorToolsResponseV1 {
  readonly connectorVersionId: ConnectorVersionId;
  readonly tools: readonly DiscoveredMcpToolV1[];
}

export interface ImportMcpToolRequestV1 {
  readonly remoteToolName: string;
  readonly toolKey: string;
  readonly toolName: string;
}

export interface ImportMcpToolsRequestV1 {
  readonly connectorVersionId: ConnectorVersionId;
  readonly tools: readonly ImportMcpToolRequestV1[];
}

export interface ImportedMcpToolResourceV1 {
  readonly toolId: string;
  readonly toolVersionId: string;
  readonly remoteToolName: string;
  readonly toolKey: string;
  readonly createdNewToolVersion: boolean;
}

export interface ImportMcpToolsResponseV1 {
  readonly imported: readonly ImportedMcpToolResourceV1[];
}
