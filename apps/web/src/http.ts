import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import {
  isApiKeyRequestPrincipal,
  isHumanSessionRequestPrincipal,
  OSVA_REQUEST_ID_HEADER,
  PUBLIC_API_ERROR_CODES,
} from "@osva-ai/contracts";
import {
  readinessFailureBody,
  type DependencyReadinessSnapshot,
} from "@osva/db";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  WorkspaceSelectionRequiredError,
} from "@osva/domain";
import type {
  AgentApplication,
  ArtifactApplication,
  ConnectorApplication,
  MemoryApplication,
  ModelProfileApplication,
  ModelProviderConnectionApplication,
  ToolApplication,
  WorkflowApplication,
  ApiKeyApplication,
} from "@osva/domain";
import {
  emitSecurityEvent,
  SECURITY_EVENT_NAMES,
  setSecurityEventInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";

import { handleAgentRegistryRequest } from "./agent-http.js";
import { handleArtifactRequest } from "./artifact-http.js";
import { handleConnectorRegistryRequest } from "./connector-http.js";
import {
  handleEvaluationRegistryRequest,
  type EvaluationHttpServices,
} from "./evaluation-http.js";
import { sendJson } from "./json.js";
import { handleMemoryRegistryRequest } from "./memory-http.js";
import { handleModelProfileRegistryRequest } from "./model-profile-http.js";
import { handleModelProviderConnectionRegistryRequest } from "./model-provider-connection-http.js";
import { handleToolRegistryRequest } from "./tool-http.js";
import {
  handleRunObservabilityRequest,
  type RunObservabilityHttpServices,
} from "./run-observability-http.js";
import { handleRunRequest, type RunHttpServices } from "./run-http.js";
import {
  handleScheduleRequest,
  type ScheduleHttpServices,
} from "./schedule-http.js";
import { handleWorkflowRequest } from "./workflow-http.js";
import {
  handleWorkflowEventRequest,
  type WorkflowEventHttpServices,
} from "./workflow-event-http.js";
import { handleOfficeRequest, type OfficeHttpServices } from "./office-http.js";
import {
  handleKnowledgeRequest,
  type KnowledgeHttpServices,
} from "./knowledge-http.js";
import { handleAuthContextRequest } from "./auth-http.js";
import {
  handleHumanAuthRequest,
  isHumanAuthRoutePath,
  type HumanAuthHttpServices,
} from "./human-auth-http.js";
import { handleApiKeyRequest } from "./api-key-http.js";
import {
  authenticateRequest,
  type WebSecurityServices,
} from "./http-security.js";
import {
  createRequestId,
  getRequestPrincipal,
  hasInvalidBearerAuthentication,
  runWithSecurityRequestContext,
  resolveRequestId,
} from "./security-request-context.js";
import { sendV1Error } from "./v1-api-error.js";
import { authorizeHumanControlPlaneRequest } from "./v1-control-plane-access.js";
import {
  consumeHttpRateLimit,
  type HttpRateLimitContext,
} from "./http-rate-limit.js";
import { parseBearerAuthorization } from "./bearer-authorization.js";
import {
  withHttpRequestTelemetry,
  type HttpRequestLog,
} from "./http-telemetry.js";
import { logEvent } from "./log.js";

export type ReadinessCheck = () => Promise<
  boolean | DependencyReadinessSnapshot
>;

export interface CreateWebApplicationOptions {
  readonly readinessCheck: ReadinessCheck;
  readonly agents: AgentApplication;
  readonly connectors: ConnectorApplication;
  readonly memory: MemoryApplication;
  readonly artifacts: ArtifactApplication;
  readonly artifactMaxBytes: number;
  readonly evaluations: EvaluationHttpServices;
  readonly modelProfiles: ModelProfileApplication;
  readonly modelProviderConnections: ModelProviderConnectionApplication;
  readonly tools: ToolApplication;
  readonly runs: RunHttpServices;
  readonly runObservability: RunObservabilityHttpServices;
  readonly schedules: ScheduleHttpServices;
  readonly workflows: WorkflowApplication;
  readonly workflowEvents?: WorkflowEventHttpServices;
  readonly office: OfficeHttpServices;
  readonly knowledge: KnowledgeHttpServices;
  readonly security: WebSecurityServices;
  readonly humanAuth?: HumanAuthHttpServices;
  readonly apiKeys: ApiKeyApplication;
  readonly rateLimit?: HttpRateLimitContext;
  readonly instrumentation?: OsvaInstrumentation;
  readonly logEvent?: HttpRequestLog;
}

export function createWebApplication(
  options: CreateWebApplicationOptions,
): http.Server {
  if (options.instrumentation !== undefined) {
    setSecurityEventInstrumentation(options.instrumentation);
  }

  return http.createServer((request, response) => {
    void handleRequest(request, response, options);
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: CreateWebApplicationOptions,
): Promise<void> {
  const requestId = createRequestId();
  response.setHeader(OSVA_REQUEST_ID_HEADER, requestId);
  const url = requestUrl(request);

  try {
    await withHttpRequestTelemetry(
      {
        method: request.method ?? "GET",
        pathname: url.pathname,
        requestId,
        response,
        instrumentation: options.instrumentation,
        logEvent: options.logEvent ?? logEvent,
      },
      async () => {
        await runWithSecurityRequestContext({ requestId }, async () => {
          const authResult = await authenticateRequest(
            request,
            options.security,
          );
          await runWithSecurityRequestContext(
            {
              requestId,
              principal: authResult.principal,
              invalidBearer: authResult.invalidBearer === true,
            },
            async () => {
              await handleRequestWithContext(
                request,
                response,
                options.readinessCheck,
                options.agents,
                options.connectors,
                options.memory,
                options.artifacts,
                options.artifactMaxBytes,
                options.evaluations,
                options.modelProfiles,
                options.modelProviderConnections,
                options.tools,
                options.runs,
                options.runObservability,
                options.schedules,
                options.workflows,
                options.workflowEvents,
                options.office,
                options.knowledge,
                options.apiKeys,
                options.rateLimit,
                options.humanAuth,
              );
            },
          );
        });
      },
    );
  } catch {
    if (!response.headersSent) {
      sendJson(response, 500, { status: "error" });
    }
  }
}

async function handleRequestWithContext(
  request: IncomingMessage,
  response: ServerResponse,
  readinessCheck: ReadinessCheck,
  agents: AgentApplication,
  connectors: ConnectorApplication,
  memory: MemoryApplication,
  artifacts: ArtifactApplication,
  artifactMaxBytes: number,
  evaluations: EvaluationHttpServices,
  modelProfiles: ModelProfileApplication,
  modelProviderConnections: ModelProviderConnectionApplication,
  tools: ToolApplication,
  runs: RunHttpServices,
  runObservability: RunObservabilityHttpServices,
  schedules: ScheduleHttpServices,
  workflows: WorkflowApplication,
  workflowEvents: WorkflowEventHttpServices | undefined,
  office: OfficeHttpServices,
  knowledge: KnowledgeHttpServices,
  apiKeys: ApiKeyApplication,
  rateLimit: HttpRateLimitContext | undefined,
  humanAuth: HumanAuthHttpServices | undefined,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = requestUrl(request);
  const path = url.pathname;

  if (path === "/health") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }

    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (path === "/ready") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }

    try {
      const result = await readinessCheck();
      if (result === true) {
        sendJson(response, 200, { status: "ready" });
        return;
      }
      if (result === false) {
        sendJson(response, 503, { status: "unavailable" });
        return;
      }
      if (result.ready) {
        sendJson(response, 200, { status: "ready" });
        return;
      }
      sendJson(response, 503, readinessFailureBody(result.failedDependencies));
      return;
    } catch {
      sendJson(response, 503, { status: "unavailable" });
      return;
    }
  }

  if (path.startsWith("/v1") && rateLimit !== undefined) {
    const decision = await consumeHttpRateLimit(
      request,
      getRequestPrincipal(),
      rateLimit,
    );
    if (decision.kind === "throttled") {
      emitSecurityEvent({
        event: SECURITY_EVENT_NAMES.RATE_LIMIT_THROTTLED,
        requestId: resolveRequestId(),
        workspaceId: (() => {
          const principal = getRequestPrincipal();
          return principal !== undefined && isApiKeyRequestPrincipal(principal)
            ? principal.workspaceId
            : undefined;
        })(),
        subjectId: (() => {
          const principal = getRequestPrincipal();
          return principal !== undefined && isApiKeyRequestPrincipal(principal)
            ? principal.subjectId
            : undefined;
        })(),
        outcome: "DENIED",
        reasonCode:
          getRequestPrincipal() === undefined
            ? "unauthenticated"
            : "authenticated",
      });
      sendV1Error(
        response,
        429,
        PUBLIC_API_ERROR_CODES.RATE_LIMITED,
        resolveRequestId(),
        { "retry-after": String(decision.retryAfterSeconds) },
      );
      return;
    }
    if (decision.kind === "unavailable") {
      emitSecurityEvent({
        event: SECURITY_EVENT_NAMES.RATE_LIMIT_STORE_UNAVAILABLE,
        requestId: resolveRequestId(),
        outcome: "DENIED",
        reasonCode: "store_unavailable",
      });
      sendV1Error(
        response,
        503,
        PUBLIC_API_ERROR_CODES.SERVICE_UNAVAILABLE,
        resolveRequestId(),
      );
      return;
    }
  }

  if (hasInvalidBearerAuthentication()) {
    sendV1Error(
      response,
      401,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      resolveRequestId(),
    );
    return;
  }

  if (humanAuth !== undefined) {
    const handledHumanAuth = await handleHumanAuthRequest(
      request,
      response,
      method,
      path,
      humanAuth,
    );
    if (handledHumanAuth) {
      return;
    }
  }

  if (path.startsWith("/v1") && !isHumanAuthRoutePath(path)) {
    const principal = getRequestPrincipal();
    if (principal === undefined) {
      if (
        parseBearerAuthorization(request.headers.authorization) === undefined
      ) {
        emitSecurityEvent({
          event: SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_MISSING,
          requestId: resolveRequestId(),
          outcome: "DENIED",
          reasonCode: "missing_bearer",
        });
      }
      sendV1Error(
        response,
        401,
        PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
        resolveRequestId(),
      );
      return;
    }

    if (isHumanSessionRequestPrincipal(principal)) {
      if (humanAuth === undefined) {
        sendV1Error(
          response,
          403,
          PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
          resolveRequestId(),
        );
        return;
      }
      try {
        const enriched = await authorizeHumanControlPlaneRequest(
          request,
          method,
          path,
          humanAuth,
          principal,
        );
        return await runWithSecurityRequestContext(
          {
            requestId: resolveRequestId(),
            principal: enriched,
            invalidBearer: false,
          },
          async () =>
            dispatchV1ControlPlaneRequest(
              request,
              response,
              method,
              path,
              url,
              agents,
              connectors,
              memory,
              artifacts,
              artifactMaxBytes,
              evaluations,
              modelProfiles,
              modelProviderConnections,
              tools,
              runs,
              runObservability,
              schedules,
              workflows,
              workflowEvents,
              office,
              knowledge,
              apiKeys,
            ),
        );
      } catch (error) {
        if (error instanceof WorkspaceSelectionRequiredError) {
          sendV1Error(
            response,
            400,
            PUBLIC_API_ERROR_CODES.WORKSPACE_SELECTION_REQUIRED,
            resolveRequestId(),
          );
          return;
        }
        if (
          error instanceof PermissionDeniedError ||
          error instanceof AuthenticationRequiredError
        ) {
          sendV1Error(
            response,
            403,
            PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
            resolveRequestId(),
          );
          return;
        }
        throw error;
      }
    }

    if (!isApiKeyRequestPrincipal(principal)) {
      sendV1Error(
        response,
        401,
        PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
        resolveRequestId(),
      );
      return;
    }
  }

  await dispatchV1ControlPlaneRequest(
    request,
    response,
    method,
    path,
    url,
    agents,
    connectors,
    memory,
    artifacts,
    artifactMaxBytes,
    evaluations,
    modelProfiles,
    modelProviderConnections,
    tools,
    runs,
    runObservability,
    schedules,
    workflows,
    workflowEvents,
    office,
    knowledge,
    apiKeys,
  );
}

async function dispatchV1ControlPlaneRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  url: URL,
  agents: AgentApplication,
  connectors: ConnectorApplication,
  memory: MemoryApplication,
  artifacts: ArtifactApplication,
  artifactMaxBytes: number,
  evaluations: EvaluationHttpServices,
  modelProfiles: ModelProfileApplication,
  modelProviderConnections: ModelProviderConnectionApplication,
  tools: ToolApplication,
  runs: RunHttpServices,
  runObservability: RunObservabilityHttpServices,
  schedules: ScheduleHttpServices,
  workflows: WorkflowApplication,
  workflowEvents: WorkflowEventHttpServices | undefined,
  office: OfficeHttpServices,
  knowledge: KnowledgeHttpServices,
  apiKeys: ApiKeyApplication,
): Promise<void> {
  const handledAuthContext = await handleAuthContextRequest(
    request,
    response,
    method,
    path,
  );
  if (handledAuthContext) {
    return;
  }

  const handledApiKeys = await handleApiKeyRequest(
    request,
    response,
    method,
    path,
    apiKeys,
  );
  if (handledApiKeys) {
    return;
  }

  const handledAgents = await handleAgentRegistryRequest(
    request,
    response,
    method,
    path,
    agents,
  );
  if (handledAgents) {
    return;
  }

  const handledModelProfiles = await handleModelProfileRegistryRequest(
    request,
    response,
    method,
    path,
    modelProfiles,
  );
  if (handledModelProfiles) {
    return;
  }

  const handledModelProviderConnections =
    await handleModelProviderConnectionRegistryRequest(
      request,
      response,
      method,
      path,
      modelProviderConnections,
    );
  if (handledModelProviderConnections) {
    return;
  }

  const handledConnectors = await handleConnectorRegistryRequest(
    request,
    response,
    method,
    path,
    connectors,
  );
  if (handledConnectors) {
    return;
  }

  const handledMemory = await handleMemoryRegistryRequest(
    request,
    response,
    method,
    path,
    url.searchParams,
    memory,
  );
  if (handledMemory) {
    return;
  }

  const handledArtifacts = await handleArtifactRequest(
    request,
    response,
    method,
    path,
    url.searchParams,
    artifacts,
    artifactMaxBytes,
  );
  if (handledArtifacts) {
    return;
  }

  const handledKnowledge = await handleKnowledgeRequest(
    request,
    response,
    method,
    path,
    url.searchParams,
    knowledge,
  );
  if (handledKnowledge) {
    return;
  }

  const handledEvaluations = await handleEvaluationRegistryRequest(
    request,
    response,
    method,
    path,
    url.searchParams,
    evaluations,
  );
  if (handledEvaluations) {
    return;
  }

  const handledTools = await handleToolRegistryRequest(
    request,
    response,
    method,
    path,
    tools,
  );
  if (handledTools) {
    return;
  }

  const handledObservability = await handleRunObservabilityRequest(
    request,
    response,
    method,
    path,
    url.searchParams,
    runObservability,
  );
  if (handledObservability) {
    return;
  }

  const handledRuns = await handleRunRequest(
    request,
    response,
    method,
    path,
    url.searchParams,
    runs,
  );
  if (handledRuns) {
    return;
  }

  const handledSchedules = await handleScheduleRequest(
    request,
    response,
    method,
    path,
    url.searchParams,
    schedules,
  );
  if (handledSchedules) {
    return;
  }

  const handledWorkflows = await handleWorkflowRequest(
    request,
    response,
    method,
    path,
    url.searchParams,
    workflows,
  );
  if (handledWorkflows) {
    return;
  }

  const handledWorkflowEvents = await handleWorkflowEventRequest(
    request,
    response,
    method,
    path,
    workflowEvents,
  );
  if (handledWorkflowEvents) {
    return;
  }

  const handledOffice = await handleOfficeRequest(
    request,
    response,
    method,
    path,
    url.searchParams,
    office,
  );
  if (handledOffice) {
    return;
  }

  sendJson(response, 404, { status: "not_found" });
}

function requestUrl(request: IncomingMessage): URL {
  try {
    return new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    return new URL("http://127.0.0.1/");
  }
}
