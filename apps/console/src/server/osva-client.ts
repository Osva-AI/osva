import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  ArtifactId,
  ConnectorId,
  ConnectorVersionId,
  RunAttemptId,
  RunId,
  RunStepId,
  ToolId,
  ToolVersionId,
  WorkflowId,
  WorkflowRunId,
  WorkflowVersionId,
  KnowledgeIndexId,
  KnowledgeSourceId,
  MemoryNamespaceId,
} from "@osva-ai/contracts";
import { OsvaHttpClient } from "@osva-ai/sdk";

import type { ConsoleConfig } from "./config.js";
import type { ConsoleUpstreamResponse } from "./upstream-response.js";

export interface ConsoleArtifactContent {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly requestId?: string;
}

export interface ConsoleOsvaClient {
  listRuns(params: {
    readonly agentId?: string;
    readonly agentVersionId?: string;
    readonly status?: string;
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<ConsoleUpstreamResponse<unknown>>;
  getRun(runId: RunId): Promise<ConsoleUpstreamResponse<unknown>>;
  listAttempts(runId: RunId): Promise<ConsoleUpstreamResponse<unknown>>;
  getAttempt(
    runId: RunId,
    runAttemptId: RunAttemptId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listAllSteps(
    runId: RunId,
    runAttemptId: RunAttemptId,
  ): Promise<ConsoleUpstreamResponse<{ steps: unknown[] }>>;
  getStep(
    runId: RunId,
    runAttemptId: RunAttemptId,
    runStepId: RunStepId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  getUsage(
    runId: RunId,
    runAttemptId: RunAttemptId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listArtifacts(query: {
    readonly runId?: RunId;
    readonly runAttemptId?: RunAttemptId;
    readonly limit?: string;
    readonly cursor?: string;
  }): Promise<ConsoleUpstreamResponse<unknown>>;
  getArtifact(
    artifactId: ArtifactId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  /**
   * Streams artifact bytes from the control plane.
   *
   * Uses `OsvaHttpClient.download()`, which returns the upstream body stream
   * without buffering. The SDK default 30s timeout applies only to waiting
   * for response headers, then is cleared. Transfer idle time is enforced
   * by the Console stream helper (`ARTIFACT_CONTENT_IDLE_TIMEOUT_MS`).
   */
  downloadArtifact(artifactId: ArtifactId): Promise<ConsoleArtifactContent>;
  listAgents(): Promise<ConsoleUpstreamResponse<unknown>>;
  getAgent(agentId: AgentId): Promise<ConsoleUpstreamResponse<unknown>>;
  createAgent(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
  listAgentVersions(
    agentId: AgentId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  getAgentVersion(
    agentId: AgentId,
    agentVersionId: AgentVersionId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  createAgentVersion(
    agentId: AgentId,
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listModelProfiles(): Promise<ConsoleUpstreamResponse<unknown>>;
  createModelProfile(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
  listModelProfileVersions(
    modelProfileId: string,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  appendModelProfileVersion(
    modelProfileId: string,
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listModelProviderConnections(): Promise<ConsoleUpstreamResponse<unknown>>;
  listModelProviderConnectionVersions(
    connectionId: string,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  createModelProviderConnection(
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  appendModelProviderConnectionVersion(
    connectionId: string,
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  testModelProviderConnectionVersion(
    connectionId: string,
    connectionVersionId: string,
    body?: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listTools(): Promise<ConsoleUpstreamResponse<unknown>>;
  getTool(toolId: ToolId): Promise<ConsoleUpstreamResponse<unknown>>;
  listToolVersions(toolId: ToolId): Promise<ConsoleUpstreamResponse<unknown>>;
  getToolVersion(
    toolId: ToolId,
    toolVersionId: ToolVersionId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listConnectors(): Promise<ConsoleUpstreamResponse<unknown>>;
  getConnector(
    connectorId: ConnectorId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  createConnector(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
  updateConnector(
    connectorId: ConnectorId,
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listConnectorVersions(
    connectorId: ConnectorId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  appendConnectorVersion(
    connectorId: ConnectorId,
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  getConnectorVersion(
    connectorId: ConnectorId,
    connectorVersionId: ConnectorVersionId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  discoverConnectorTools(
    connectorId: ConnectorId,
    connectorVersionId: ConnectorVersionId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  importMcpTools(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
  createRun(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
  listWorkflows(): Promise<ConsoleUpstreamResponse<unknown>>;
  createWorkflow(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
  getWorkflow(
    workflowId: WorkflowId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  appendWorkflowVersion(
    workflowId: WorkflowId,
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listWorkflowVersions(
    workflowId: WorkflowId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  getWorkflowVersion(
    workflowId: WorkflowId,
    workflowVersionId: WorkflowVersionId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listWorkflowRuns(params: {
    readonly workflowId?: string;
    readonly workflowVersionId?: string;
    readonly status?: string;
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<ConsoleUpstreamResponse<unknown>>;
  getWorkflowRun(
    workflowRunId: WorkflowRunId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  createWorkflowRun(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
  getApprovalRequest(
    approvalRequestId: ApprovalRequestId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  decideApprovalRequest(
    approvalRequestId: ApprovalRequestId,
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  ingestWorkflowEvent(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
  listKnowledgeSources(params: {
    readonly limit?: number;
    readonly cursor?: string;
  }): Promise<ConsoleUpstreamResponse<unknown>>;
  createKnowledgeSource(
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  getKnowledgeSource(
    knowledgeSourceId: KnowledgeSourceId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listKnowledgeIndexes(
    knowledgeSourceId: KnowledgeSourceId,
    params: { readonly limit?: number; readonly cursor?: string },
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  createKnowledgeIndex(
    knowledgeSourceId: KnowledgeSourceId,
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  getKnowledgeIndex(
    knowledgeIndexId: KnowledgeIndexId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  retryKnowledgeIndex(
    knowledgeIndexId: KnowledgeIndexId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  retrieveKnowledge(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
  listMemoryNamespaces(): Promise<ConsoleUpstreamResponse<unknown>>;
  createMemoryNamespace(
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  getMemoryNamespace(
    namespaceId: MemoryNamespaceId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  listMemoryRecords(
    namespaceId: MemoryNamespaceId,
    params: {
      readonly prefix?: string;
      readonly limit?: number;
      readonly cursor?: string;
    },
  ): Promise<ConsoleUpstreamResponse<unknown>>;
}

export function createConsoleOsvaClient(
  config: ConsoleConfig & { readonly osvaApiKey: string },
): ConsoleOsvaClient {
  const http = new OsvaHttpClient({
    baseUrl: config.osvaBaseUrl,
    apiKey: config.osvaApiKey,
  });

  return {
    listRuns: (params) =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/runs",
        query: {
          agentId: params.agentId,
          agentVersionId: params.agentVersionId,
          status: params.status,
          limit: params.limit === undefined ? undefined : String(params.limit),
          cursor: params.cursor,
        },
      }),
    getRun: (runId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/runs/${encodeURIComponent(runId)}`,
      }),
    listAttempts: (runId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/runs/${encodeURIComponent(runId)}/attempts`,
      }),
    getAttempt: (runId, runAttemptId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}`,
      }),
    listAllSteps: async (runId, runAttemptId) => {
      const steps: unknown[] = [];
      let cursor: string | undefined;
      let requestId: string | undefined;
      do {
        const page = await http.requestWithMeta<{
          steps: unknown[];
          nextCursor?: string;
        }>({
          method: "GET",
          path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps`,
          query: {
            limit: "100",
            cursor,
          },
        });
        steps.push(...page.data.steps);
        cursor = page.data.nextCursor;
        requestId = page.requestId ?? requestId;
      } while (cursor !== undefined);
      return { data: { steps }, requestId };
    },
    getStep: (runId, runAttemptId, runStepId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps/${encodeURIComponent(runStepId)}`,
      }),
    getUsage: (runId, runAttemptId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/usage`,
      }),
    listArtifacts: (query) =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/artifacts",
        query: {
          runId: query.runId,
          runAttemptId: query.runAttemptId,
          limit: query.limit,
          cursor: query.cursor,
        },
      }),
    getArtifact: (artifactId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/artifacts/${encodeURIComponent(artifactId)}`,
      }),
    downloadArtifact: async (artifactId) => {
      const downloaded = await http.download({
        path: `/v1/artifacts/${encodeURIComponent(artifactId)}/content`,
      });
      const requestId = downloaded.headers.get("x-osva-request-id")?.trim();
      return {
        status: downloaded.status,
        headers: downloaded.headers,
        body: downloaded.body,
        requestId:
          requestId === undefined || requestId.length === 0
            ? undefined
            : requestId,
      };
    },
    listAgents: () =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/agents",
      }),
    getAgent: (agentId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/agents/${encodeURIComponent(agentId)}`,
      }),
    createAgent: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/agents",
        body,
      }),
    listAgentVersions: (agentId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/agents/${encodeURIComponent(agentId)}/versions`,
      }),
    getAgentVersion: (agentId, agentVersionId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(agentVersionId)}`,
      }),
    createAgentVersion: (agentId, body) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/agents/${encodeURIComponent(agentId)}/versions`,
        body,
      }),
    listModelProfiles: () =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/model-profiles",
      }),
    createModelProfile: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/model-profiles",
        body,
      }),
    listModelProfileVersions: (modelProfileId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
      }),
    appendModelProfileVersion: (modelProfileId, body) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
        body,
      }),
    listModelProviderConnections: () =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/model-provider-connections",
      }),
    listModelProviderConnectionVersions: (connectionId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
      }),
    createModelProviderConnection: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/model-provider-connections",
        body,
      }),
    appendModelProviderConnectionVersion: (connectionId, body) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
        body,
      }),
    testModelProviderConnectionVersion: (
      connectionId,
      connectionVersionId,
      body,
    ) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions/${encodeURIComponent(connectionVersionId)}/test`,
        body,
      }),
    listTools: () =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/tools",
      }),
    getTool: (toolId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/tools/${encodeURIComponent(toolId)}`,
      }),
    listToolVersions: (toolId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/tools/${encodeURIComponent(toolId)}/versions`,
      }),
    getToolVersion: (toolId, toolVersionId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/tools/${encodeURIComponent(toolId)}/versions/${encodeURIComponent(toolVersionId)}`,
      }),
    listConnectors: () =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/connectors",
      }),
    getConnector: (connectorId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}`,
      }),
    createConnector: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/connectors",
        body,
      }),
    updateConnector: (connectorId, body) =>
      http.requestWithMeta({
        method: "PATCH",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}`,
        body,
      }),
    listConnectorVersions: (connectorId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
      }),
    appendConnectorVersion: (connectorId, body) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
        body,
      }),
    getConnectorVersion: (connectorId, connectorVersionId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}`,
      }),
    discoverConnectorTools: (connectorId, connectorVersionId) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}/discover`,
      }),
    importMcpTools: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/connectors/import-mcp-tools",
        body,
      }),
    createRun: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/runs",
        body,
      }),
    listWorkflows: () =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/workflows",
      }),
    createWorkflow: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/workflows",
        body,
      }),
    getWorkflow: (workflowId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/workflows/${encodeURIComponent(workflowId)}`,
      }),
    appendWorkflowVersion: (workflowId, body) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
        body,
      }),
    listWorkflowVersions: (workflowId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
      }),
    getWorkflowVersion: (workflowId, workflowVersionId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(workflowVersionId)}`,
      }),
    listWorkflowRuns: (params) =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/workflow-runs",
        query: {
          workflowId: params.workflowId,
          workflowVersionId: params.workflowVersionId,
          status: params.status,
          limit: params.limit === undefined ? undefined : String(params.limit),
          cursor: params.cursor,
        },
      }),
    getWorkflowRun: (workflowRunId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/workflow-runs/${encodeURIComponent(workflowRunId)}`,
      }),
    createWorkflowRun: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/workflow-runs",
        body,
      }),
    getApprovalRequest: (approvalRequestId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/approval-requests/${encodeURIComponent(approvalRequestId)}`,
      }),
    decideApprovalRequest: (approvalRequestId, body) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/approval-requests/${encodeURIComponent(approvalRequestId)}/decision`,
        body,
      }),
    ingestWorkflowEvent: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/workflow-events",
        body,
      }),
    listKnowledgeSources: (params) =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/knowledge-sources",
        query: {
          limit: params.limit === undefined ? undefined : String(params.limit),
          cursor: params.cursor,
        },
      }),
    createKnowledgeSource: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/knowledge-sources",
        body,
      }),
    getKnowledgeSource: (knowledgeSourceId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}`,
      }),
    listKnowledgeIndexes: (knowledgeSourceId, params) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}/indexes`,
        query: {
          limit: params.limit === undefined ? undefined : String(params.limit),
          cursor: params.cursor,
        },
      }),
    createKnowledgeIndex: (knowledgeSourceId, body) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}/indexes`,
        body,
      }),
    getKnowledgeIndex: (knowledgeIndexId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/knowledge-indexes/${encodeURIComponent(knowledgeIndexId)}`,
      }),
    retryKnowledgeIndex: (knowledgeIndexId) =>
      http.requestWithMeta({
        method: "POST",
        path: `/v1/knowledge-indexes/${encodeURIComponent(knowledgeIndexId)}/retry`,
        body: {},
      }),
    retrieveKnowledge: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/knowledge/retrieve",
        body,
      }),
    listMemoryNamespaces: () =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/memory/namespaces",
      }),
    createMemoryNamespace: (body) =>
      http.requestWithMeta({
        method: "POST",
        path: "/v1/memory/namespaces",
        body,
      }),
    getMemoryNamespace: (namespaceId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/memory/namespaces/${encodeURIComponent(namespaceId)}`,
      }),
    listMemoryRecords: (namespaceId, params) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/memory/namespaces/${encodeURIComponent(namespaceId)}/records`,
        query: {
          prefix: params.prefix,
          limit: params.limit === undefined ? undefined : String(params.limit),
          cursor: params.cursor,
        },
      }),
  };
}
