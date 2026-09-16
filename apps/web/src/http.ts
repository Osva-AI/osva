import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import type {
  AgentApplication,
  ModelProfileApplication,
  ToolApplication,
  WorkflowApplication,
} from "@osva/domain";

import { handleAgentRegistryRequest } from "./agent-http.js";
import { sendJson } from "./json.js";
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

export type ReadinessCheck = () => Promise<boolean>;

export interface CreateWebApplicationOptions {
  readonly readinessCheck: ReadinessCheck;
  readonly agents: AgentApplication;
  readonly modelProfiles: ModelProfileApplication;
  readonly tools: ToolApplication;
  readonly runs: RunHttpServices;
  readonly runObservability: RunObservabilityHttpServices;
  readonly schedules: ScheduleHttpServices;
  readonly workflows: WorkflowApplication;
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
      options.modelProfiles,
      options.tools,
      options.runs,
      options.runObservability,
      options.schedules,
      options.workflows,
    );
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  readinessCheck: ReadinessCheck,
  agents: AgentApplication,
  modelProfiles: ModelProfileApplication,
  tools: ToolApplication,
  runs: RunHttpServices,
  runObservability: RunObservabilityHttpServices,
  schedules: ScheduleHttpServices,
  workflows: WorkflowApplication,
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

  sendJson(response, 404, { status: "not_found" });
}

function requestUrl(request: IncomingMessage): URL {
  try {
    return new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    return new URL("http://127.0.0.1/");
  }
}
