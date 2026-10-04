import type { IncomingMessage, ServerResponse } from "node:http";

import type { RunAttemptId, RunId, RunStepId } from "@osva-ai/contracts";

import { ConsoleConfigurationError } from "../config.js";
import { mapOsvaError, sendJson } from "../console-http.js";
import type { ConsoleOsvaClient } from "../osva-client.js";
import type { ResponseSecurityOptions } from "../response-security.js";
import { upstreamRequestIdHeaders } from "../upstream-response.js";

export interface ConsoleApiDependencies {
  readonly client: ConsoleOsvaClient | undefined;
  readonly security: ResponseSecurityOptions;
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

  const method = request.method ?? "GET";
  if (method !== "GET") {
    sendJson(
      response,
      405,
      { error: "Method not allowed." },
      { Allow: "GET" },
      deps.security,
    );
    return true;
  }

  if (deps.client === undefined) {
    sendJson(
      response,
      503,
      {
        error:
          "Console is not configured. Set OSVA_CONSOLE_API_KEY and restart.",
        code: "console_not_configured",
      },
      {},
      deps.security,
    );
    return true;
  }

  try {
    if (pathname === "/api/v1/auth/context") {
      const context = await deps.client.getAuthContext();
      sendJson(
        response,
        200,
        context.data,
        upstreamRequestIdHeaders(context.requestId),
        deps.security,
      );
      return true;
    }

    if (pathname === "/api/v1/runs") {
      const listed = await deps.client.listRuns({
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
      const run = await deps.client.getRun(runMatch[1] as RunId);
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
      const attempts = await deps.client.listAttempts(
        attemptsMatch[1] as RunId,
      );
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
      const attempt = await deps.client.getAttempt(
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
      const steps = await deps.client.listAllSteps(
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
      const step = await deps.client.getStep(
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
      const usage = await deps.client.getUsage(
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

    if (pathname === "/api/v1/artifacts") {
      const runIdParam = searchParams.get("runId");
      const runAttemptIdParam = searchParams.get("runAttemptId");
      const listed = await deps.client.listArtifacts({
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

    sendJson(
      response,
      404,
      { error: "Console API route not found." },
      {},
      deps.security,
    );
    return true;
  } catch (error) {
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

function parseOptionalInt(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
