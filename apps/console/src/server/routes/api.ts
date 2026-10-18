import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  RunAttemptId,
  RunId,
  RunStepId,
  WorkflowId,
  WorkflowRunId,
  WorkflowVersionId,
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

      sendJson(
        response,
        405,
        { error: "Method not allowed." },
        { Allow: "GET, POST" },
        deps.security,
      );
      return true;
    }

    if (method !== "GET") {
      sendJson(
        response,
        405,
        { error: "Method not allowed." },
        { Allow: "GET, POST" },
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
