import type {
  ApprovalRequestId,
  RunAttemptId,
  RunId,
  RunStepId,
  WorkflowId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva-ai/contracts";
import { OsvaHttpClient } from "@osva-ai/sdk";

import type { ConsoleConfig } from "./config.js";
import type { ConsoleUpstreamResponse } from "./upstream-response.js";

export interface ConsoleOsvaClient {
  getAuthContext(): Promise<
    ConsoleUpstreamResponse<Awaited<ReturnType<OsvaHttpClient["request"]>>>
  >;
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
  listWorkflows(): Promise<ConsoleUpstreamResponse<unknown>>;
  getWorkflow(
    workflowId: WorkflowId,
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
  getApprovalRequest(
    approvalRequestId: ApprovalRequestId,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  decideApprovalRequest(
    approvalRequestId: ApprovalRequestId,
    body: unknown,
  ): Promise<ConsoleUpstreamResponse<unknown>>;
  ingestWorkflowEvent(body: unknown): Promise<ConsoleUpstreamResponse<unknown>>;
}

export function createConsoleOsvaClient(
  config: ConsoleConfig,
): ConsoleOsvaClient {
  const http = new OsvaHttpClient({
    baseUrl: config.osvaBaseUrl,
    apiKey: config.osvaApiKey,
  });

  return {
    getAuthContext: () =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/auth/context",
      }),
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
    listWorkflows: () =>
      http.requestWithMeta({
        method: "GET",
        path: "/v1/workflows",
      }),
    getWorkflow: (workflowId) =>
      http.requestWithMeta({
        method: "GET",
        path: `/v1/workflows/${encodeURIComponent(workflowId)}`,
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
  };
}
