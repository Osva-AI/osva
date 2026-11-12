import type { ConsoleConfig } from "./config.js";
import {
  BUILDER_GENERATION_UPSTREAM_TIMEOUT_MS,
  createHumanSessionUpstream,
  type HumanSessionUpstreamContext,
} from "./human-session-upstream.js";
import type {
  ConsoleArtifactContent,
  ConsoleOsvaClient,
} from "./osva-client.js";
import type { ConsoleUpstreamResponse } from "./upstream-response.js";

export function createHumanSessionOsvaClient(
  config: ConsoleConfig,
  ctx: HumanSessionUpstreamContext,
): ConsoleOsvaClient {
  const upstream = createHumanSessionUpstream(config);

  return {
    listRuns: (params) =>
      upstream
        .requestJson<{ runs: unknown[]; nextCursor?: string }>(ctx, {
          method: "GET",
          path: "/v1/runs",
          query: {
            agentId: params.agentId,
            agentVersionId: params.agentVersionId,
            status: params.status,
            limit:
              params.limit === undefined ? undefined : String(params.limit),
            cursor: params.cursor,
          },
        })
        .then(toDataOnly),

    getRun: (runId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/runs/${encodeURIComponent(runId)}`,
        })
        .then(toDataOnly),

    listAttempts: (runId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/runs/${encodeURIComponent(runId)}/attempts`,
        })
        .then(toDataOnly),

    getAttempt: (runId, runAttemptId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}`,
        })
        .then(toDataOnly),

    listAllSteps: async (runId, runAttemptId) => {
      const steps: unknown[] = [];
      let cursor: string | undefined;
      let requestId: string | undefined;
      do {
        const page = await upstream.requestJson<{
          steps: unknown[];
          nextCursor?: string;
        }>(ctx, {
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
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps/${encodeURIComponent(runStepId)}`,
        })
        .then(toDataOnly),

    getUsage: (runId, runAttemptId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/usage`,
        })
        .then(toDataOnly),

    listArtifacts: (query) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: "/v1/artifacts",
          query: {
            runId: query.runId,
            runAttemptId: query.runAttemptId,
            limit: query.limit,
            cursor: query.cursor,
          },
        })
        .then(toDataOnly),

    getArtifact: (artifactId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/artifacts/${encodeURIComponent(artifactId)}`,
        })
        .then(toDataOnly),

    downloadArtifact: async (artifactId) => {
      const downloaded = await upstream.download(
        ctx,
        `/v1/artifacts/${encodeURIComponent(artifactId)}/content`,
      );
      return {
        status: downloaded.status,
        headers: downloaded.headers,
        body: downloaded.body,
        requestId: downloaded.requestId,
      } satisfies ConsoleArtifactContent;
    },

    listAgents: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/agents" })
        .then(toDataOnly),

    getAgent: (agentId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/agents/${encodeURIComponent(agentId)}`,
        })
        .then(toDataOnly),

    createAgent: (body) =>
      upstream
        .requestJson(ctx, { method: "POST", path: "/v1/agents", body })
        .then(toDataOnly),

    listAgentVersions: (agentId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/agents/${encodeURIComponent(agentId)}/versions`,
        })
        .then(toDataOnly),

    getAgentVersion: (agentId, agentVersionId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(agentVersionId)}`,
        })
        .then(toDataOnly),

    createAgentVersion: (agentId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/agents/${encodeURIComponent(agentId)}/versions`,
          body,
        })
        .then(toDataOnly),

    listModelProfiles: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/model-profiles" })
        .then(toDataOnly),

    createModelProfile: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/model-profiles",
          body,
        })
        .then(toDataOnly),

    listModelProfileVersions: (modelProfileId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
        })
        .then(toDataOnly),

    appendModelProfileVersion: (modelProfileId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
          body,
        })
        .then(toDataOnly),

    listModelProviderConnections: () =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: "/v1/model-provider-connections",
        })
        .then(toDataOnly),

    listModelProviderConnectionVersions: (connectionId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
        })
        .then(toDataOnly),

    createModelProviderConnection: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/model-provider-connections",
          body,
        })
        .then(toDataOnly),

    appendModelProviderConnectionVersion: (connectionId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
          body,
        })
        .then(toDataOnly),

    testModelProviderConnectionVersion: (
      connectionId,
      connectionVersionId,
      body,
    ) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions/${encodeURIComponent(connectionVersionId)}/test`,
          body,
        })
        .then(toDataOnly),

    listTools: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/tools" })
        .then(toDataOnly),

    getTool: (toolId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/tools/${encodeURIComponent(toolId)}`,
        })
        .then(toDataOnly),

    listToolVersions: (toolId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/tools/${encodeURIComponent(toolId)}/versions`,
        })
        .then(toDataOnly),

    getToolVersion: (toolId, toolVersionId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/tools/${encodeURIComponent(toolId)}/versions/${encodeURIComponent(toolVersionId)}`,
        })
        .then(toDataOnly),

    listConnectors: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/connectors" })
        .then(toDataOnly),

    getConnector: (connectorId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/connectors/${encodeURIComponent(connectorId)}`,
        })
        .then(toDataOnly),

    createConnector: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/connectors",
          body,
        })
        .then(toDataOnly),

    updateConnector: (connectorId, body) =>
      upstream
        .requestJson(ctx, {
          method: "PATCH",
          path: `/v1/connectors/${encodeURIComponent(connectorId)}`,
          body,
        })
        .then(toDataOnly),

    listConnectorVersions: (connectorId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
        })
        .then(toDataOnly),

    appendConnectorVersion: (connectorId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
          body,
        })
        .then(toDataOnly),

    getConnectorVersion: (connectorId, connectorVersionId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}`,
        })
        .then(toDataOnly),

    discoverConnectorTools: (connectorId, connectorVersionId) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}/discover`,
        })
        .then(toDataOnly),

    importMcpTools: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/connectors/import-mcp-tools",
          body,
        })
        .then(toDataOnly),

    createRun: (body) =>
      upstream
        .requestJson(ctx, { method: "POST", path: "/v1/runs", body })
        .then(toDataOnly),

    listWorkflows: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/workflows" })
        .then(toDataOnly),

    createWorkflow: (body) =>
      upstream
        .requestJson(ctx, { method: "POST", path: "/v1/workflows", body })
        .then(toDataOnly),

    getWorkflow: (workflowId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/workflows/${encodeURIComponent(workflowId)}`,
        })
        .then(toDataOnly),

    appendWorkflowVersion: (workflowId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
          body,
        })
        .then(toDataOnly),

    listWorkflowVersions: (workflowId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
        })
        .then(toDataOnly),

    getWorkflowVersion: (workflowId, workflowVersionId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(workflowVersionId)}`,
        })
        .then(toDataOnly),

    listWorkflowRuns: (params) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: "/v1/workflow-runs",
          query: {
            workflowId: params.workflowId,
            workflowVersionId: params.workflowVersionId,
            status: params.status,
            limit:
              params.limit === undefined ? undefined : String(params.limit),
            cursor: params.cursor,
          },
        })
        .then(toDataOnly),

    getWorkflowRun: (workflowRunId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/workflow-runs/${encodeURIComponent(workflowRunId)}`,
        })
        .then(toDataOnly),

    createWorkflowRun: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/workflow-runs",
          body,
        })
        .then(toDataOnly),

    getApprovalRequest: (approvalRequestId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/approval-requests/${encodeURIComponent(approvalRequestId)}`,
        })
        .then(toDataOnly),

    decideApprovalRequest: (approvalRequestId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/approval-requests/${encodeURIComponent(approvalRequestId)}/decision`,
          body,
        })
        .then(toDataOnly),

    ingestWorkflowEvent: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/workflow-events",
          body,
        })
        .then(toDataOnly),

    listKnowledgeSources: (params) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: "/v1/knowledge-sources",
          query: {
            limit:
              params.limit === undefined ? undefined : String(params.limit),
            cursor: params.cursor,
          },
        })
        .then(toDataOnly),

    createKnowledgeSource: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/knowledge-sources",
          body,
        })
        .then(toDataOnly),

    getKnowledgeSource: (knowledgeSourceId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}`,
        })
        .then(toDataOnly),

    listKnowledgeIndexes: (knowledgeSourceId, params) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}/indexes`,
          query: {
            limit:
              params.limit === undefined ? undefined : String(params.limit),
            cursor: params.cursor,
          },
        })
        .then(toDataOnly),

    createKnowledgeIndex: (knowledgeSourceId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}/indexes`,
          body,
        })
        .then(toDataOnly),

    getKnowledgeIndex: (knowledgeIndexId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/knowledge-indexes/${encodeURIComponent(knowledgeIndexId)}`,
        })
        .then(toDataOnly),

    retryKnowledgeIndex: (knowledgeIndexId) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/knowledge-indexes/${encodeURIComponent(knowledgeIndexId)}/retry`,
          body: {},
        })
        .then(toDataOnly),

    retrieveKnowledge: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/knowledge/retrieve",
          body,
        })
        .then(toDataOnly),

    listMemoryNamespaces: () =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: "/v1/memory/namespaces",
        })
        .then(toDataOnly),

    createMemoryNamespace: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/memory/namespaces",
          body,
        })
        .then(toDataOnly),

    getMemoryNamespace: (namespaceId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/memory/namespaces/${encodeURIComponent(namespaceId)}`,
        })
        .then(toDataOnly),

    listMemoryRecords: (namespaceId, params) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/memory/namespaces/${encodeURIComponent(namespaceId)}/records`,
          query: {
            prefix: params.prefix,
            limit:
              params.limit === undefined ? undefined : String(params.limit),
            cursor: params.cursor,
          },
        })
        .then(toDataOnly),

    listEvaluationSuites: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/evaluation-suites" })
        .then(toDataOnly),

    createEvaluationSuite: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/evaluation-suites",
          body,
        })
        .then(toDataOnly),

    getEvaluationSuite: (evaluationSuiteId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/evaluation-suites/${encodeURIComponent(evaluationSuiteId)}`,
        })
        .then(toDataOnly),

    listEvaluationSuiteVersions: (evaluationSuiteId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/evaluation-suites/${encodeURIComponent(evaluationSuiteId)}/versions`,
        })
        .then(toDataOnly),

    createEvaluationSuiteVersion: (evaluationSuiteId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/evaluation-suites/${encodeURIComponent(evaluationSuiteId)}/versions`,
          body,
        })
        .then(toDataOnly),

    getEvaluationSuiteVersion: (evaluationSuiteId, evaluationSuiteVersionId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/evaluation-suites/${encodeURIComponent(evaluationSuiteId)}/versions/${encodeURIComponent(evaluationSuiteVersionId)}`,
        })
        .then(toDataOnly),

    listEvaluationRuns: (params) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: "/v1/evaluation-runs",
          query: {
            evaluationSuiteId: params.evaluationSuiteId,
            evaluationSuiteVersionId: params.evaluationSuiteVersionId,
            agentVersionId: params.agentVersionId,
            status: params.status,
            limit:
              params.limit === undefined ? undefined : String(params.limit),
            cursor: params.cursor,
          },
        })
        .then(toDataOnly),

    getEvaluationRun: (evaluationRunId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/evaluation-runs/${encodeURIComponent(evaluationRunId)}`,
        })
        .then(toDataOnly),

    createEvaluationRun: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/evaluation-runs",
          body,
        })
        .then(toDataOnly),

    listEvaluationCaseResults: (evaluationRunId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/evaluation-runs/${encodeURIComponent(evaluationRunId)}/case-results`,
        })
        .then(toDataOnly),

    generateBuilderProposal: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/builder/proposals/generate",
          body,
          timeoutMs: BUILDER_GENERATION_UPSTREAM_TIMEOUT_MS,
          acceptErrorStatuses: [422],
        })
        .then(toDataOnly),

    refineBuilderProposal: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/builder/proposals/refine",
          body,
          timeoutMs: BUILDER_GENERATION_UPSTREAM_TIMEOUT_MS,
          acceptErrorStatuses: [422],
        })
        .then(toDataOnly),

    validateBuilderProposal: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/builder/proposals/validate",
          body,
        })
        .then(toDataOnly),

    prepareBuilderPublication: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/builder/publications/prepare",
          body,
        })
        .then(toDataOnly),

    publishBuilderProposal: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/builder/publications",
          body,
          acceptErrorStatuses: [409, 422],
        })
        .then(toDataOnly),

    getBuilderPublicationReceipt: (publicationId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/builder/publications/${encodeURIComponent(publicationId)}`,
        })
        .then(toDataOnly),

    listApiKeys: () =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: "/v1/api-keys",
          requireWorkspace: true,
        })
        .then(toDataOnly),

    createApiKey: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/api-keys",
          body,
          requireWorkspace: true,
        })
        .then(toDataOnly),

    revokeApiKey: (apiKeyId) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/api-keys/${encodeURIComponent(apiKeyId)}/revoke`,
          requireWorkspace: true,
        })
        .then(toDataOnly),

    listOfficeWorkers: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/office/workers" })
        .then(toDataOnly),

    getOfficeWorker: (officeWorkerId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/office/workers/${encodeURIComponent(officeWorkerId)}`,
        })
        .then(toDataOnly),

    createOfficeWorker: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/office/workers",
          body,
        })
        .then(toDataOnly),

    updateOfficeWorker: (officeWorkerId, body) =>
      upstream
        .requestJson(ctx, {
          method: "PATCH",
          path: `/v1/office/workers/${encodeURIComponent(officeWorkerId)}`,
          body,
        })
        .then(toDataOnly),

    listOfficeRoles: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/office/roles" })
        .then(toDataOnly),

    getOfficeRole: (roleId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/office/roles/${encodeURIComponent(roleId)}`,
        })
        .then(toDataOnly),

    createOfficeRole: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/office/roles",
          body,
        })
        .then(toDataOnly),

    updateOfficeRole: (roleId, body) =>
      upstream
        .requestJson(ctx, {
          method: "PATCH",
          path: `/v1/office/roles/${encodeURIComponent(roleId)}`,
          body,
        })
        .then(toDataOnly),

    listOfficeTeams: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/office/teams" })
        .then(toDataOnly),

    getOfficeTeam: (teamId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/office/teams/${encodeURIComponent(teamId)}`,
        })
        .then(toDataOnly),

    createOfficeTeam: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/office/teams",
          body,
        })
        .then(toDataOnly),

    updateOfficeTeam: (teamId, body) =>
      upstream
        .requestJson(ctx, {
          method: "PATCH",
          path: `/v1/office/teams/${encodeURIComponent(teamId)}`,
          body,
        })
        .then(toDataOnly),

    listTeamMemberships: (teamId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/office/teams/${encodeURIComponent(teamId)}/memberships`,
        })
        .then(toDataOnly),

    addTeamMembership: (teamId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/office/teams/${encodeURIComponent(teamId)}/memberships`,
          body,
        })
        .then(toDataOnly),

    listOfficeAssignments: () =>
      upstream
        .requestJson(ctx, { method: "GET", path: "/v1/office/assignments" })
        .then(toDataOnly),

    listOfficeThreads: (query) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/office/threads${collaborationQuerySuffix(query)}`,
        })
        .then(toDataOnly),

    createOfficeThread: (body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: "/v1/office/threads",
          body,
        })
        .then(toDataOnly),

    getOfficeThread: (threadId) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/office/threads/${encodeURIComponent(threadId)}`,
        })
        .then(toDataOnly),

    listOfficeThreadMessages: (threadId, query) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/office/threads/${encodeURIComponent(threadId)}/messages${collaborationQuerySuffix(query)}`,
        })
        .then(toDataOnly),

    postOfficeThreadMessage: (threadId, body) =>
      upstream
        .requestJson(ctx, {
          method: "POST",
          path: `/v1/office/threads/${encodeURIComponent(threadId)}/messages`,
          body,
        })
        .then(toDataOnly),

    listOfficeInbox: (query) =>
      upstream
        .requestJson(ctx, {
          method: "GET",
          path: `/v1/office/inbox${collaborationQuerySuffix(query)}`,
        })
        .then(toDataOnly),

    updateOfficeInboxReadState: (body) =>
      upstream
        .requestJson(ctx, {
          method: "PATCH",
          path: "/v1/office/inbox/read-state",
          body,
        })
        .then(toDataOnly),
  };
}

function collaborationQuerySuffix(query?: {
  readonly cursor?: string;
  readonly limit?: number;
}): string {
  const params = new URLSearchParams();
  if (query?.cursor !== undefined) {
    params.set("cursor", query.cursor);
  }
  if (query?.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  return params.size > 0 ? `?${params.toString()}` : "";
}

function toDataOnly<T>(
  result: ConsoleUpstreamResponse<T> & {
    readonly setCookie?: readonly string[];
    readonly status: number;
  },
): ConsoleUpstreamResponse<T> {
  return {
    data: result.data,
    requestId: result.requestId,
    status: result.status,
  };
}
