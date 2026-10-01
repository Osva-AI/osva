import type {
  ConnectorId,
  ConnectorVersionId,
  ModelProfileId,
  ModelProfileVersionId,
} from "@osva-ai/contracts";
import {
  connectorListResourceSchema,
  connectorResourceSchema,
  connectorVersionListResourceSchema,
  connectorVersionResourceSchema,
  createConnectorRequestSchema,
  createConnectorVersionRequestSchema,
  createModelProfileRequestSchema,
  createModelProfileVersionRequestSchema,
  discoverConnectorToolsResponseSchema,
  importMcpToolsRequestSchema,
  importMcpToolsResponseSchema,
  modelProfileListResourceSchema,
  modelProfileResourceSchema,
  modelProfileVersionListResourceSchema,
  modelProfileVersionResourceSchema,
} from "@osva-ai/contracts/schemas";
import { OsvaClient, OsvaHttpClient } from "@osva-ai/sdk";
import type { SetupEnv } from "./env.js";

type CreateModelProfileRequest = {
  readonly key: string;
  readonly name: string;
};
type CreateModelProfileVersionRequest = {
  readonly provider: string;
  readonly model: string;
};
type CreateConnectorRequest = {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
};
type CreateConnectorVersionRequest = {
  readonly kind: "MCP";
  readonly transport: "STDIO";
  readonly transportConfig: {
    readonly command: string;
    readonly args: readonly string[];
  };
};
type ImportMcpToolsRequest = {
  readonly connectorVersionId: ConnectorVersionId;
  readonly tools: readonly {
    readonly remoteToolName: string;
    readonly toolKey: string;
    readonly toolName: string;
  }[];
};

export class SetupApi {
  readonly sdk: OsvaClient;
  readonly http: OsvaHttpClient;

  constructor(env: SetupEnv) {
    this.http = new OsvaHttpClient({
      baseUrl: env.baseUrl,
      apiKey: env.apiKey,
      timeoutMs: env.setupTimeoutMs,
    });
    this.sdk = new OsvaClient({
      baseUrl: env.baseUrl,
      apiKey: env.apiKey,
      timeoutMs: env.setupTimeoutMs,
    });
  }

  async verifyConnection(workspaceId: string): Promise<void> {
    const agents = await this.sdk.agents.list();
    if (agents.agents.length > 0) {
      const foreign = agents.agents.find(
        (agent) => agent.workspaceId !== workspaceId,
      );
      if (foreign !== undefined) {
        throw new Error("API key workspace does not match OSVA_WORKSPACE_ID.");
      }
    }
  }

  async findModelProfileByKey(key: string) {
    const listed = modelProfileListResourceSchema.parse(
      await this.http.request({
        method: "GET",
        path: "/v1/model-profiles",
      }),
    );
    return listed.modelProfiles.find((profile) => profile.key === key) ?? null;
  }

  async createModelProfile(input: CreateModelProfileRequest) {
    return modelProfileResourceSchema.parse(
      await this.http.request({
        method: "POST",
        path: "/v1/model-profiles",
        body: input,
      }),
    );
  }

  async listModelProfileVersions(modelProfileId: ModelProfileId) {
    return modelProfileVersionListResourceSchema.parse(
      await this.http.request({
        method: "GET",
        path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
      }),
    );
  }

  async createModelProfileVersion(
    modelProfileId: ModelProfileId,
    input: CreateModelProfileVersionRequest,
  ) {
    return modelProfileVersionResourceSchema.parse(
      await this.http.request({
        method: "POST",
        path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
        body: input,
      }),
    );
  }

  async getModelProfileVersion(
    modelProfileId: ModelProfileId,
    modelProfileVersionId: ModelProfileVersionId,
  ) {
    return modelProfileVersionResourceSchema.parse(
      await this.http.request({
        method: "GET",
        path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions/${encodeURIComponent(modelProfileVersionId)}`,
      }),
    );
  }

  async findConnectorByKey(key: string) {
    const listed = connectorListResourceSchema.parse(
      await this.http.request({
        method: "GET",
        path: "/v1/connectors",
      }),
    );
    return listed.connectors.find((connector) => connector.key === key) ?? null;
  }

  async createConnector(input: CreateConnectorRequest) {
    return connectorResourceSchema.parse(
      await this.http.request({
        method: "POST",
        path: "/v1/connectors",
        body: input,
      }),
    );
  }

  async listConnectorVersions(connectorId: ConnectorId) {
    return connectorVersionListResourceSchema.parse(
      await this.http.request({
        method: "GET",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
      }),
    );
  }

  async createConnectorVersion(
    connectorId: ConnectorId,
    input: CreateConnectorVersionRequest,
  ) {
    return connectorVersionResourceSchema.parse(
      await this.http.request({
        method: "POST",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
        body: input,
      }),
    );
  }

  async getConnectorVersion(
    connectorId: ConnectorId,
    connectorVersionId: ConnectorVersionId,
  ) {
    return connectorVersionResourceSchema.parse(
      await this.http.request({
        method: "GET",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}`,
      }),
    );
  }

  async discoverConnectorTools(
    connectorId: ConnectorId,
    connectorVersionId: ConnectorVersionId,
  ) {
    return discoverConnectorToolsResponseSchema.parse(
      await this.http.request({
        method: "POST",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}/discover`,
        body: {},
      }),
    );
  }

  async importMcpTools(input: ImportMcpToolsRequest) {
    return importMcpToolsResponseSchema.parse(
      await this.http.request({
        method: "POST",
        path: "/v1/connectors/import-mcp-tools",
        body: input,
      }),
    );
  }
}
