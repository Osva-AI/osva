import type { ConnectorId, ConnectorVersionId } from "@osva-ai/contracts";
import {
  connectorListResourceSchema,
  connectorResourceSchema,
  connectorVersionListResourceSchema,
  connectorVersionResourceSchema,
  createConnectorRequestSchema,
  createConnectorVersionRequestSchema,
  discoverConnectorToolsResponseSchema,
  importMcpToolsRequestSchema,
  importMcpToolsResponseSchema,
} from "@osva-ai/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type ConnectorListResource = z.infer<typeof connectorListResourceSchema>;
type ConnectorResource = z.infer<typeof connectorResourceSchema>;
type ConnectorVersionListResource = z.infer<
  typeof connectorVersionListResourceSchema
>;
type ConnectorVersionResource = z.infer<typeof connectorVersionResourceSchema>;
type CreateConnectorRequest = z.infer<typeof createConnectorRequestSchema>;
type CreateConnectorVersionRequest = z.infer<
  typeof createConnectorVersionRequestSchema
>;
type DiscoverConnectorToolsResponse = z.infer<
  typeof discoverConnectorToolsResponseSchema
>;
type ImportMcpToolsRequest = z.infer<typeof importMcpToolsRequestSchema>;
type ImportMcpToolsResponse = z.infer<typeof importMcpToolsResponseSchema>;

export class ConnectorsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<ConnectorListResource> {
    return this.client.request({ method: "GET", path: "/v1/connectors" });
  }

  get(connectorId: ConnectorId): Promise<ConnectorResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/connectors/${encodeURIComponent(connectorId)}`,
    });
  }

  create(input: CreateConnectorRequest): Promise<ConnectorResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/connectors",
      body: input,
    });
  }

  listVersions(
    connectorId: ConnectorId,
  ): Promise<ConnectorVersionListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
    });
  }

  getVersion(
    connectorId: ConnectorId,
    connectorVersionId: ConnectorVersionId,
  ): Promise<ConnectorVersionResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}`,
    });
  }

  createVersion(
    connectorId: ConnectorId,
    input: CreateConnectorVersionRequest,
  ): Promise<ConnectorVersionResource> {
    return this.client.request({
      method: "POST",
      path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
      body: input,
    });
  }

  discover(
    connectorId: ConnectorId,
    connectorVersionId: ConnectorVersionId,
  ): Promise<DiscoverConnectorToolsResponse> {
    return this.client.request({
      method: "POST",
      path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}/discover`,
      body: {},
    });
  }

  importMcpTools(
    input: ImportMcpToolsRequest,
  ): Promise<ImportMcpToolsResponse> {
    return this.client.request({
      method: "POST",
      path: "/v1/connectors/import-mcp-tools",
      body: input,
    });
  }
}
