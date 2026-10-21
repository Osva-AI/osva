import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  ConnectorId,
  ConnectorVersionId,
  EvaluationRunId,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
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

import {
  buildArtifactDownloadHeaders,
  filenameFromContentDisposition,
  parseConsoleArtifactId,
  pipeArtifactBodyToResponse,
} from "../artifact-download.js";
import { ConsoleConfigurationError } from "../config.js";
import {
  emitConsoleRequestGuardDenial,
  emitConsoleRequestTooLarge,
} from "../console-security-events.js";
import type { ConsoleConfig } from "../config.js";
import { mapOsvaError, sendJson } from "../console-http.js";
import { ConsoleUpstreamHttpError } from "../human-session-upstream.js";
import type { ConsoleOsvaClient } from "../osva-client.js";
import { readJsonBody } from "../read-json-body.js";
import { evaluateConsoleApiRequestGuard } from "../request-guard.js";
import { resolveConsoleClient } from "../resolve-console-client.js";
import type { ResponseSecurityOptions } from "../response-security.js";
import { appendSessionSetCookieLines } from "../session-cookie.js";
import { upstreamRequestIdHeaders } from "../upstream-response.js";
import { tryHandleConsoleAuthApiRequest } from "./auth-api.js";

export interface ConsoleApiDependencies {
  readonly config: ConsoleConfig | undefined;
  readonly legacyClient: ConsoleOsvaClient | undefined;
  readonly testClient: ConsoleOsvaClient | undefined;
  readonly security: ResponseSecurityOptions;
  readonly allowedOrigins?: readonly string[];
}

export async function handleConsoleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  searchParams: URLSearchParams,
  deps: ConsoleApiDependencies,
): Promise<boolean> {
  if (!pathname.startsWith("/api/v1/")) {
    return false;
  }

  const guard = evaluateConsoleApiRequestGuard(request, {
    allowedOrigins: deps.allowedOrigins ?? [],
  });
  if (!guard.allowed) {
    emitConsoleRequestGuardDenial(guard);
    sendJson(
      response,
      guard.status,
      { error: guard.error, code: guard.code },
      {},
      deps.security,
    );
    return true;
  }

  const method = request.method ?? "GET";

  if (browserAuthorizationPresent(request)) {
    sendJson(
      response,
      403,
      {
        error: "Browser Authorization headers are not accepted by the Console.",
        code: "invalid_request",
      },
      {},
      deps.security,
    );
    return true;
  }

  if (
    deps.config !== undefined &&
    !deps.config.legacyApiKeyMode &&
    (pathname.startsWith("/api/v1/auth/") ||
      pathname === "/api/v1/me/workspaces")
  ) {
    try {
      const authHandled = await tryHandleConsoleAuthApiRequest(
        request,
        response,
        pathname,
        method,
        {
          config: deps.config,
          security: deps.security,
          ctx: { incoming: request },
        },
      );
      if (authHandled) {
        return true;
      }
    } catch (error) {
      forwardUpstreamErrorCookies(response, error);
      const mapped = mapOsvaError(error);
      sendJson(
        response,
        mapped.status,
        mapped.body,
        upstreamRequestIdHeaders(mapped.requestId ?? mapped.body.requestId),
        deps.security,
      );
      return true;
    }
  }

  const { client } = resolveConsoleClient(request, {
    config: deps.config,
    legacyClient: deps.legacyClient,
    testClient: deps.testClient,
  });

  if (client === undefined) {
    sendJson(
      response,
      503,
      {
        error:
          "Console is not configured. Set OSVA_BASE_URL and ensure the control plane is reachable.",
        code: "console_not_configured",
      },
      {},
      deps.security,
    );
    return true;
  }

  try {
    if (method === "POST") {
      const approvalDecisionMatch = pathname.match(
        /^\/api\/v1\/approval-requests\/([^/]+)\/decision$/,
      );
      if (approvalDecisionMatch !== null) {
        const body = await readJsonBody(request);
        const decided = await client.decideApprovalRequest(
          approvalDecisionMatch[1] as ApprovalRequestId,
          body,
        );
        sendJson(
          response,
          200,
          decided.data,
          upstreamRequestIdHeaders(decided.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/workflow-events") {
        const body = await readJsonBody(request);
        const ingested = await client.ingestWorkflowEvent(body);
        sendJson(
          response,
          201,
          ingested.data,
          upstreamRequestIdHeaders(ingested.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/workflows") {
        const body = await readJsonBody(request);
        const created = await client.createWorkflow(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      const workflowVersionPostMatch = pathname.match(
        /^\/api\/v1\/workflows\/([^/]+)\/versions$/,
      );
      if (workflowVersionPostMatch !== null) {
        const body = await readJsonBody(request);
        const created = await client.appendWorkflowVersion(
          workflowVersionPostMatch[1] as WorkflowId,
          body,
        );
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/workflow-runs") {
        const body = await readJsonBody(request);
        const created = await client.createWorkflowRun(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/agents") {
        const body = await readJsonBody(request);
        const created = await client.createAgent(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/model-provider-connections") {
        const body = await readJsonBody(request);
        const created = await client.createModelProviderConnection(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/model-profiles") {
        const body = await readJsonBody(request);
        const created = await client.createModelProfile(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      const modelProfileVersionPostMatch = pathname.match(
        /^\/api\/v1\/model-profiles\/([^/]+)\/versions$/,
      );
      if (modelProfileVersionPostMatch !== null) {
        const body = await readJsonBody(request);
        const created = await client.appendModelProfileVersion(
          modelProfileVersionPostMatch[1] ?? "",
          body,
        );
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      const connectionVersionPostMatch = pathname.match(
        /^\/api\/v1\/model-provider-connections\/([^/]+)\/versions$/,
      );
      if (connectionVersionPostMatch !== null) {
        const body = await readJsonBody(request);
        const created = await client.appendModelProviderConnectionVersion(
          connectionVersionPostMatch[1] ?? "",
          body,
        );
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      const connectionTestMatch = pathname.match(
        /^\/api\/v1\/model-provider-connections\/([^/]+)\/versions\/([^/]+)\/test$/,
      );
      if (connectionTestMatch !== null) {
        const body = await readJsonBody(request);
        const result = await client.testModelProviderConnectionVersion(
          connectionTestMatch[1] ?? "",
          connectionTestMatch[2] ?? "",
          body,
        );
        sendJson(
          response,
          200,
          result.data,
          upstreamRequestIdHeaders(result.requestId),
          deps.security,
        );
        return true;
      }

      const agentVersionPostMatch = pathname.match(
        /^\/api\/v1\/agents\/([^/]+)\/versions$/,
      );
      if (agentVersionPostMatch !== null) {
        const body = await readJsonBody(request);
        const created = await client.createAgentVersion(
          agentVersionPostMatch[1] as AgentId,
          body,
        );
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/runs") {
        const body = await readJsonBody(request);
        const created = await client.createRun(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/connectors") {
        const body = await readJsonBody(request);
        const created = await client.createConnector(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/connectors/import-mcp-tools") {
        const body = await readJsonBody(request);
        const imported = await client.importMcpTools(body);
        sendJson(
          response,
          200,
          imported.data,
          upstreamRequestIdHeaders(imported.requestId),
          deps.security,
        );
        return true;
      }

      const connectorVersionPostMatch = pathname.match(
        /^\/api\/v1\/connectors\/([^/]+)\/versions$/,
      );
      if (connectorVersionPostMatch !== null) {
        const body = await readJsonBody(request);
        const created = await client.appendConnectorVersion(
          connectorVersionPostMatch[1] as ConnectorId,
          body,
        );
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      const connectorDiscoverMatch = pathname.match(
        /^\/api\/v1\/connectors\/([^/]+)\/versions\/([^/]+)\/discover$/,
      );
      if (connectorDiscoverMatch !== null) {
        const discovered = await client.discoverConnectorTools(
          connectorDiscoverMatch[1] as ConnectorId,
          connectorDiscoverMatch[2] as ConnectorVersionId,
        );
        sendJson(
          response,
          200,
          discovered.data,
          upstreamRequestIdHeaders(discovered.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/knowledge-sources") {
        const body = await readJsonBody(request);
        const created = await client.createKnowledgeSource(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      const knowledgeSourceIndexesPostMatch = pathname.match(
        /^\/api\/v1\/knowledge-sources\/([^/]+)\/indexes$/,
      );
      if (knowledgeSourceIndexesPostMatch !== null) {
        const body = await readJsonBody(request);
        const created = await client.createKnowledgeIndex(
          knowledgeSourceIndexesPostMatch[1] as KnowledgeSourceId,
          body,
        );
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      const knowledgeIndexRetryPostMatch = pathname.match(
        /^\/api\/v1\/knowledge-indexes\/([^/]+)\/retry$/,
      );
      if (knowledgeIndexRetryPostMatch !== null) {
        const retried = await client.retryKnowledgeIndex(
          knowledgeIndexRetryPostMatch[1] as KnowledgeIndexId,
        );
        sendJson(
          response,
          200,
          retried.data,
          upstreamRequestIdHeaders(retried.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/knowledge/retrieve") {
        const body = await readJsonBody(request);
        const retrieved = await client.retrieveKnowledge(body);
        sendJson(
          response,
          200,
          retrieved.data,
          upstreamRequestIdHeaders(retrieved.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/memory/namespaces") {
        const body = await readJsonBody(request);
        const created = await client.createMemoryNamespace(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/evaluation-suites") {
        const body = await readJsonBody(request);
        const created = await client.createEvaluationSuite(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      const evaluationSuiteVersionPostMatch = pathname.match(
        /^\/api\/v1\/evaluation-suites\/([^/]+)\/versions$/,
      );
      if (evaluationSuiteVersionPostMatch !== null) {
        const body = await readJsonBody(request);
        const created = await client.createEvaluationSuiteVersion(
          evaluationSuiteVersionPostMatch[1] as EvaluationSuiteId,
          body,
        );
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      if (pathname === "/api/v1/evaluation-runs") {
        const body = await readJsonBody(request);
        const created = await client.createEvaluationRun(body);
        sendJson(
          response,
          201,
          created.data,
          upstreamRequestIdHeaders(created.requestId),
          deps.security,
        );
        return true;
      }

      sendJson(
        response,
        405,
        { error: "Method not allowed." },
        { Allow: "GET, POST, PATCH" },
        deps.security,
      );
      return true;
    }

    if (method === "PATCH") {
      const connectorPatchMatch = pathname.match(
        /^\/api\/v1\/connectors\/([^/]+)$/,
      );
      if (connectorPatchMatch !== null) {
        const body = await readJsonBody(request);
        const updated = await client.updateConnector(
          connectorPatchMatch[1] as ConnectorId,
          body,
        );
        sendJson(
          response,
          200,
          updated.data,
          upstreamRequestIdHeaders(updated.requestId),
          deps.security,
        );
        return true;
      }

      sendJson(
        response,
        405,
        { error: "Method not allowed." },
        { Allow: "GET, POST, PATCH" },
        deps.security,
      );
      return true;
    }

    if (method !== "GET") {
      sendJson(
        response,
        405,
        { error: "Method not allowed." },
        { Allow: "GET, POST, PATCH" },
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/runs") {
      const listed = await client.listRuns({
        agentId: searchParams.get("agentId") ?? undefined,
        agentVersionId: searchParams.get("agentVersionId") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        limit: parseOptionalInt(searchParams.get("limit")),
        cursor: searchParams.get("cursor") ?? undefined,
      });
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const runMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
    if (runMatch !== null) {
      const run = await client.getRun(runMatch[1] as RunId);
      sendJson(
        response,
        200,
        run.data,
        upstreamRequestIdHeaders(run.requestId),
        deps.security,
      );
      return true;
    }

    const attemptsMatch = pathname.match(
      /^\/api\/v1\/runs\/([^/]+)\/attempts$/,
    );
    if (attemptsMatch !== null) {
      const attempts = await client.listAttempts(attemptsMatch[1] as RunId);
      sendJson(
        response,
        200,
        attempts.data,
        upstreamRequestIdHeaders(attempts.requestId),
        deps.security,
      );
      return true;
    }

    const attemptMatch = pathname.match(
      /^\/api\/v1\/runs\/([^/]+)\/attempts\/([^/]+)$/,
    );
    if (attemptMatch !== null) {
      const attempt = await client.getAttempt(
        attemptMatch[1] as RunId,
        attemptMatch[2] as RunAttemptId,
      );
      sendJson(
        response,
        200,
        attempt.data,
        upstreamRequestIdHeaders(attempt.requestId),
        deps.security,
      );
      return true;
    }

    const stepsMatch = pathname.match(
      /^\/api\/v1\/runs\/([^/]+)\/attempts\/([^/]+)\/steps$/,
    );
    if (stepsMatch !== null) {
      const steps = await client.listAllSteps(
        stepsMatch[1] as RunId,
        stepsMatch[2] as RunAttemptId,
      );
      sendJson(
        response,
        200,
        steps.data,
        upstreamRequestIdHeaders(steps.requestId),
        deps.security,
      );
      return true;
    }

    const stepMatch = pathname.match(
      /^\/api\/v1\/runs\/([^/]+)\/attempts\/([^/]+)\/steps\/([^/]+)$/,
    );
    if (stepMatch !== null) {
      const step = await client.getStep(
        stepMatch[1] as RunId,
        stepMatch[2] as RunAttemptId,
        stepMatch[3] as RunStepId,
      );
      sendJson(
        response,
        200,
        step.data,
        upstreamRequestIdHeaders(step.requestId),
        deps.security,
      );
      return true;
    }

    const usageMatch = pathname.match(
      /^\/api\/v1\/runs\/([^/]+)\/attempts\/([^/]+)\/usage$/,
    );
    if (usageMatch !== null) {
      const usage = await client.getUsage(
        usageMatch[1] as RunId,
        usageMatch[2] as RunAttemptId,
      );
      sendJson(
        response,
        200,
        usage.data,
        upstreamRequestIdHeaders(usage.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/agents") {
      const listed = await client.listAgents();
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/tools") {
      const listed = await client.listTools();
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const toolVersionItemMatch = pathname.match(
      /^\/api\/v1\/tools\/([^/]+)\/versions\/([^/]+)$/,
    );
    if (toolVersionItemMatch !== null) {
      const version = await client.getToolVersion(
        toolVersionItemMatch[1] as ToolId,
        toolVersionItemMatch[2] as ToolVersionId,
      );
      sendJson(
        response,
        200,
        version.data,
        upstreamRequestIdHeaders(version.requestId),
        deps.security,
      );
      return true;
    }

    const toolVersionsMatch = pathname.match(
      /^\/api\/v1\/tools\/([^/]+)\/versions$/,
    );
    if (toolVersionsMatch !== null) {
      const versions = await client.listToolVersions(
        toolVersionsMatch[1] as ToolId,
      );
      sendJson(
        response,
        200,
        versions.data,
        upstreamRequestIdHeaders(versions.requestId),
        deps.security,
      );
      return true;
    }

    const toolItemMatch = pathname.match(/^\/api\/v1\/tools\/([^/]+)$/);
    if (toolItemMatch !== null) {
      const tool = await client.getTool(toolItemMatch[1] as ToolId);
      sendJson(
        response,
        200,
        tool.data,
        upstreamRequestIdHeaders(tool.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/connectors") {
      const listed = await client.listConnectors();
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const connectorVersionItemMatch = pathname.match(
      /^\/api\/v1\/connectors\/([^/]+)\/versions\/([^/]+)$/,
    );
    if (connectorVersionItemMatch !== null) {
      const version = await client.getConnectorVersion(
        connectorVersionItemMatch[1] as ConnectorId,
        connectorVersionItemMatch[2] as ConnectorVersionId,
      );
      sendJson(
        response,
        200,
        version.data,
        upstreamRequestIdHeaders(version.requestId),
        deps.security,
      );
      return true;
    }

    const connectorVersionsMatch = pathname.match(
      /^\/api\/v1\/connectors\/([^/]+)\/versions$/,
    );
    if (connectorVersionsMatch !== null) {
      const versions = await client.listConnectorVersions(
        connectorVersionsMatch[1] as ConnectorId,
      );
      sendJson(
        response,
        200,
        versions.data,
        upstreamRequestIdHeaders(versions.requestId),
        deps.security,
      );
      return true;
    }

    const connectorItemMatch = pathname.match(
      /^\/api\/v1\/connectors\/([^/]+)$/,
    );
    if (connectorItemMatch !== null) {
      const connector = await client.getConnector(
        connectorItemMatch[1] as ConnectorId,
      );
      sendJson(
        response,
        200,
        connector.data,
        upstreamRequestIdHeaders(connector.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/model-profiles") {
      const listed = await client.listModelProfiles();
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const modelProfileVersionsMatch = pathname.match(
      /^\/api\/v1\/model-profiles\/([^/]+)\/versions$/,
    );
    if (modelProfileVersionsMatch !== null) {
      const versions = await client.listModelProfileVersions(
        modelProfileVersionsMatch[1] ?? "",
      );
      sendJson(
        response,
        200,
        versions.data,
        upstreamRequestIdHeaders(versions.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/model-provider-connections") {
      const listed = await client.listModelProviderConnections();
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const connectionVersionsMatch = pathname.match(
      /^\/api\/v1\/model-provider-connections\/([^/]+)\/versions$/,
    );
    if (connectionVersionsMatch !== null) {
      const versions = await client.listModelProviderConnectionVersions(
        connectionVersionsMatch[1] ?? "",
      );
      sendJson(
        response,
        200,
        versions.data,
        upstreamRequestIdHeaders(versions.requestId),
        deps.security,
      );
      return true;
    }

    const agentVersionItemMatch = pathname.match(
      /^\/api\/v1\/agents\/([^/]+)\/versions\/([^/]+)$/,
    );
    if (agentVersionItemMatch !== null) {
      const version = await client.getAgentVersion(
        agentVersionItemMatch[1] as AgentId,
        agentVersionItemMatch[2] as AgentVersionId,
      );
      sendJson(
        response,
        200,
        version.data,
        upstreamRequestIdHeaders(version.requestId),
        deps.security,
      );
      return true;
    }

    const agentVersionsMatch = pathname.match(
      /^\/api\/v1\/agents\/([^/]+)\/versions$/,
    );
    if (agentVersionsMatch !== null) {
      const versions = await client.listAgentVersions(
        agentVersionsMatch[1] as AgentId,
      );
      sendJson(
        response,
        200,
        versions.data,
        upstreamRequestIdHeaders(versions.requestId),
        deps.security,
      );
      return true;
    }

    const agentItemMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
    if (agentItemMatch !== null) {
      const agent = await client.getAgent(agentItemMatch[1] as AgentId);
      sendJson(
        response,
        200,
        agent.data,
        upstreamRequestIdHeaders(agent.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/workflows") {
      const listed = await client.listWorkflows();
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const workflowMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)$/);
    if (workflowMatch !== null) {
      const workflow = await client.getWorkflow(workflowMatch[1] as WorkflowId);
      sendJson(
        response,
        200,
        workflow.data,
        upstreamRequestIdHeaders(workflow.requestId),
        deps.security,
      );
      return true;
    }

    const workflowVersionsMatch = pathname.match(
      /^\/api\/v1\/workflows\/([^/]+)\/versions$/,
    );
    if (workflowVersionsMatch !== null) {
      const versions = await client.listWorkflowVersions(
        workflowVersionsMatch[1] as WorkflowId,
      );
      sendJson(
        response,
        200,
        versions.data,
        upstreamRequestIdHeaders(versions.requestId),
        deps.security,
      );
      return true;
    }

    const workflowVersionMatch = pathname.match(
      /^\/api\/v1\/workflows\/([^/]+)\/versions\/([^/]+)$/,
    );
    if (workflowVersionMatch !== null) {
      const version = await client.getWorkflowVersion(
        workflowVersionMatch[1] as WorkflowId,
        workflowVersionMatch[2] as WorkflowVersionId,
      );
      sendJson(
        response,
        200,
        version.data,
        upstreamRequestIdHeaders(version.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/workflow-runs") {
      const listed = await client.listWorkflowRuns({
        workflowId: searchParams.get("workflowId") ?? undefined,
        workflowVersionId: searchParams.get("workflowVersionId") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        limit: parseOptionalInt(searchParams.get("limit")),
        cursor: searchParams.get("cursor") ?? undefined,
      });
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const workflowRunMatch = pathname.match(
      /^\/api\/v1\/workflow-runs\/([^/]+)$/,
    );
    if (workflowRunMatch !== null) {
      const workflowRun = await client.getWorkflowRun(
        workflowRunMatch[1] as WorkflowRunId,
      );
      sendJson(
        response,
        200,
        workflowRun.data,
        upstreamRequestIdHeaders(workflowRun.requestId),
        deps.security,
      );
      return true;
    }

    const approvalMatch = pathname.match(
      /^\/api\/v1\/approval-requests\/([^/]+)$/,
    );
    if (approvalMatch !== null) {
      const approval = await client.getApprovalRequest(
        approvalMatch[1] as ApprovalRequestId,
      );
      sendJson(
        response,
        200,
        approval.data,
        upstreamRequestIdHeaders(approval.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/knowledge-sources") {
      const limitParam = searchParams.get("limit");
      const limit =
        limitParam === null ? undefined : Number.parseInt(limitParam, 10);
      const listed = await client.listKnowledgeSources({
        limit:
          limit !== undefined && Number.isInteger(limit) ? limit : undefined,
        cursor: searchParams.get("cursor") ?? undefined,
      });
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const knowledgeSourceItemMatch = pathname.match(
      /^\/api\/v1\/knowledge-sources\/([^/]+)$/,
    );
    if (knowledgeSourceItemMatch !== null && method === "GET") {
      const source = await client.getKnowledgeSource(
        knowledgeSourceItemMatch[1] as KnowledgeSourceId,
      );
      sendJson(
        response,
        200,
        source.data,
        upstreamRequestIdHeaders(source.requestId),
        deps.security,
      );
      return true;
    }

    const knowledgeSourceIndexesMatch = pathname.match(
      /^\/api\/v1\/knowledge-sources\/([^/]+)\/indexes$/,
    );
    if (knowledgeSourceIndexesMatch !== null) {
      const sourceId = knowledgeSourceIndexesMatch[1] as KnowledgeSourceId;
      const limitParam = searchParams.get("limit");
      const limit =
        limitParam === null ? undefined : Number.parseInt(limitParam, 10);
      const listed = await client.listKnowledgeIndexes(sourceId, {
        limit:
          limit !== undefined && Number.isInteger(limit) ? limit : undefined,
        cursor: searchParams.get("cursor") ?? undefined,
      });
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const knowledgeIndexItemMatch = pathname.match(
      /^\/api\/v1\/knowledge-indexes\/([^/]+)$/,
    );
    if (knowledgeIndexItemMatch !== null && method === "GET") {
      const index = await client.getKnowledgeIndex(
        knowledgeIndexItemMatch[1] as KnowledgeIndexId,
      );
      sendJson(
        response,
        200,
        index.data,
        upstreamRequestIdHeaders(index.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/evaluation-suites") {
      const listed = await client.listEvaluationSuites();
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const evaluationSuiteMatch = pathname.match(
      /^\/api\/v1\/evaluation-suites\/([^/]+)$/,
    );
    if (evaluationSuiteMatch !== null) {
      const suite = await client.getEvaluationSuite(
        evaluationSuiteMatch[1] as EvaluationSuiteId,
      );
      sendJson(
        response,
        200,
        suite.data,
        upstreamRequestIdHeaders(suite.requestId),
        deps.security,
      );
      return true;
    }

    const evaluationSuiteVersionsMatch = pathname.match(
      /^\/api\/v1\/evaluation-suites\/([^/]+)\/versions$/,
    );
    if (evaluationSuiteVersionsMatch !== null) {
      const versions = await client.listEvaluationSuiteVersions(
        evaluationSuiteVersionsMatch[1] as EvaluationSuiteId,
      );
      sendJson(
        response,
        200,
        versions.data,
        upstreamRequestIdHeaders(versions.requestId),
        deps.security,
      );
      return true;
    }

    const evaluationSuiteVersionMatch = pathname.match(
      /^\/api\/v1\/evaluation-suites\/([^/]+)\/versions\/([^/]+)$/,
    );
    if (evaluationSuiteVersionMatch !== null) {
      const version = await client.getEvaluationSuiteVersion(
        evaluationSuiteVersionMatch[1] as EvaluationSuiteId,
        evaluationSuiteVersionMatch[2] as EvaluationSuiteVersionId,
      );
      sendJson(
        response,
        200,
        version.data,
        upstreamRequestIdHeaders(version.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/evaluation-runs") {
      const listed = await client.listEvaluationRuns({
        evaluationSuiteId: searchParams.get("evaluationSuiteId") ?? undefined,
        evaluationSuiteVersionId:
          searchParams.get("evaluationSuiteVersionId") ?? undefined,
        agentVersionId: searchParams.get("agentVersionId") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        limit: parseOptionalInt(searchParams.get("limit")),
        cursor: searchParams.get("cursor") ?? undefined,
      });
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const evaluationRunCaseResultsMatch = pathname.match(
      /^\/api\/v1\/evaluation-runs\/([^/]+)\/case-results$/,
    );
    if (evaluationRunCaseResultsMatch !== null) {
      const results = await client.listEvaluationCaseResults(
        evaluationRunCaseResultsMatch[1] as EvaluationRunId,
      );
      sendJson(
        response,
        200,
        results.data,
        upstreamRequestIdHeaders(results.requestId),
        deps.security,
      );
      return true;
    }

    const evaluationRunMatch = pathname.match(
      /^\/api\/v1\/evaluation-runs\/([^/]+)$/,
    );
    if (evaluationRunMatch !== null) {
      const evaluationRun = await client.getEvaluationRun(
        evaluationRunMatch[1] as EvaluationRunId,
      );
      sendJson(
        response,
        200,
        evaluationRun.data,
        upstreamRequestIdHeaders(evaluationRun.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/memory/namespaces") {
      const listed = await client.listMemoryNamespaces();
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const memoryNamespaceItemMatch = pathname.match(
      /^\/api\/v1\/memory\/namespaces\/([^/]+)$/,
    );
    if (memoryNamespaceItemMatch !== null && method === "GET") {
      const namespace = await client.getMemoryNamespace(
        memoryNamespaceItemMatch[1] as MemoryNamespaceId,
      );
      sendJson(
        response,
        200,
        namespace.data,
        upstreamRequestIdHeaders(namespace.requestId),
        deps.security,
      );
      return true;
    }

    const memoryRecordsMatch = pathname.match(
      /^\/api\/v1\/memory\/namespaces\/([^/]+)\/records$/,
    );
    if (memoryRecordsMatch !== null && method === "GET") {
      const limitParam = searchParams.get("limit");
      const limit =
        limitParam === null ? undefined : Number.parseInt(limitParam, 10);
      const listed = await client.listMemoryRecords(
        memoryRecordsMatch[1] as MemoryNamespaceId,
        {
          prefix: searchParams.get("prefix") ?? undefined,
          limit:
            limit !== undefined && Number.isInteger(limit) ? limit : undefined,
          cursor: searchParams.get("cursor") ?? undefined,
        },
      );
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/artifacts") {
      const runIdParam = searchParams.get("runId");
      const runAttemptIdParam = searchParams.get("runAttemptId");
      const listed = await client.listArtifacts({
        runId:
          runIdParam === null || runIdParam.length === 0
            ? undefined
            : (runIdParam as RunId),
        runAttemptId:
          runAttemptIdParam === null || runAttemptIdParam.length === 0
            ? undefined
            : (runAttemptIdParam as RunAttemptId),
        limit: searchParams.get("limit") ?? undefined,
        cursor: searchParams.get("cursor") ?? undefined,
      });
      sendJson(
        response,
        200,
        listed.data,
        upstreamRequestIdHeaders(listed.requestId),
        deps.security,
      );
      return true;
    }

    const artifactContentMatch = pathname.match(
      /^\/api\/v1\/artifacts\/([^/]+)\/content$/,
    );
    if (artifactContentMatch !== null) {
      const artifactId = parseConsoleArtifactId(artifactContentMatch[1] ?? "");
      if (artifactId === undefined) {
        sendJson(
          response,
          400,
          { error: "Invalid artifact id.", code: "invalid_request" },
          {},
          deps.security,
        );
        return true;
      }

      const downloaded = await client.downloadArtifact(artifactId);
      if (downloaded.body === null) {
        sendJson(
          response,
          503,
          {
            error: "Requested resource is unavailable.",
            code: "unavailable",
            requestId: downloaded.requestId,
          },
          upstreamRequestIdHeaders(downloaded.requestId),
          deps.security,
        );
        return true;
      }

      const headers = buildArtifactDownloadHeaders({
        mediaType: headerValue(downloaded.headers, "content-type"),
        contentLength: headerValue(downloaded.headers, "content-length"),
        digest: headerValue(downloaded.headers, "digest"),
        filename: filenameFromContentDisposition(
          headerValue(downloaded.headers, "content-disposition"),
        ),
        requestId: downloaded.requestId,
      });
      response.writeHead(200, headers);
      try {
        await pipeArtifactBodyToResponse({
          body: downloaded.body,
          request,
          response,
        });
      } catch {
        if (!response.writableEnded) {
          response.destroy();
        }
      }
      return true;
    }

    const artifactMatch = pathname.match(/^\/api\/v1\/artifacts\/([^/]+)$/);
    if (artifactMatch !== null) {
      const artifactId = parseConsoleArtifactId(artifactMatch[1] ?? "");
      if (artifactId === undefined) {
        sendJson(
          response,
          400,
          { error: "Invalid artifact id.", code: "invalid_request" },
          {},
          deps.security,
        );
        return true;
      }

      const artifact = await client.getArtifact(artifactId);
      sendJson(
        response,
        200,
        artifact.data,
        upstreamRequestIdHeaders(artifact.requestId),
        deps.security,
      );
      return true;
    }

    sendJson(
      response,
      404,
      { error: "Console API route not found." },
      {},
      deps.security,
    );
    return true;
  } catch (error) {
    forwardUpstreamErrorCookies(response, error);
    if (error instanceof ConsoleConfigurationError) {
      sendJson(
        response,
        503,
        { error: error.message, code: "console_not_configured" },
        {},
        deps.security,
      );
      return true;
    }
    const mapped = mapOsvaError(error);
    if (mapped.body.code === "request_too_large") {
      emitConsoleRequestTooLarge();
    }
    sendJson(
      response,
      mapped.status,
      mapped.body,
      upstreamRequestIdHeaders(mapped.requestId ?? mapped.body.requestId),
      deps.security,
    );
    return true;
  }
}

function browserAuthorizationPresent(request: IncomingMessage): boolean {
  const raw = request.headers.authorization;
  if (raw === undefined) {
    return false;
  }
  const value = typeof raw === "string" ? raw : raw[0];
  return (value?.trim().length ?? 0) > 0;
}

function forwardUpstreamErrorCookies(
  response: ServerResponse,
  error: unknown,
): void {
  if (error instanceof ConsoleUpstreamHttpError) {
    appendSessionSetCookieLines(response, error.setCookie);
  }
}

function parseOptionalInt(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function headerValue(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  if (value === null || value.trim().length === 0) {
    return undefined;
  }
  return value;
}
