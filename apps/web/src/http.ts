import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import type {
  AgentApplication,
  ArtifactApplication,
  ConnectorApplication,
  MemoryApplication,
  ModelProfileApplication,
  ToolApplication,
  WorkflowApplication,
} from "@osva/domain";

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

export type ReadinessCheck = () => Promise<boolean>;

export interface CreateWebApplicationOptions {
  readonly readinessCheck: ReadinessCheck;
  readonly agents: AgentApplication;
  readonly connectors: ConnectorApplication;
  readonly memory: MemoryApplication;
  readonly artifacts: ArtifactApplication;
  readonly artifactMaxBytes: number;
  readonly evaluations: EvaluationHttpServices;
  readonly modelProfiles: ModelProfileApplication;
  readonly tools: ToolApplication;
  readonly runs: RunHttpServices;
  readonly runObservability: RunObservabilityHttpServices;
  readonly schedules: ScheduleHttpServices;
  readonly workflows: WorkflowApplication;
  readonly workflowEvents?: WorkflowEventHttpServices;
  readonly office: OfficeHttpServices;
}

export function createWebApplication(
  options: CreateWebApplicationOptions,
): http.Server {
  return http.createServer((request, response) => {
    void handleRequest(
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
      options.tools,
      options.runs,
      options.runObservability,
      options.schedules,
      options.workflows,
      options.workflowEvents,
      options.office,
    );
  });
}

async function handleRequest(
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
  tools: ToolApplication,
  runs: RunHttpServices,
  runObservability: RunObservabilityHttpServices,
  schedules: ScheduleHttpServices,
  workflows: WorkflowApplication,
  workflowEvents: WorkflowEventHttpServices | undefined,
  office: OfficeHttpServices,
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

    let ready = false;
    try {
      ready = (await readinessCheck()) === true;
    } catch {
      ready = false;
    }

    if (ready) {
      sendJson(response, 200, { status: "ready" });
      return;
    }

    sendJson(response, 503, { status: "unavailable" });
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
    workflows,
    url.searchParams,
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
