import type { ConsoleConfig } from "./config.js";
import {
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
  };
}

function toDataOnly<T>(
  result: ConsoleUpstreamResponse<T> & {
    readonly setCookie?: readonly string[];
  },
): ConsoleUpstreamResponse<T> {
  return { data: result.data, requestId: result.requestId };
}
