import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import type { AgentApplication } from "@osva/domain";

import { handleAgentRegistryRequest } from "./agent-http.js";
import { sendJson } from "./json.js";

export type ReadinessCheck = () => Promise<boolean>;

export interface CreateWebApplicationOptions {
  readonly readinessCheck: ReadinessCheck;
  readonly agents: AgentApplication;
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
    );
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  readinessCheck: ReadinessCheck,
  agents: AgentApplication,
): Promise<void> {
  const method = request.method ?? "GET";
  const path = requestPath(request);

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

  const handled = await handleAgentRegistryRequest(
    request,
    response,
    method,
    path,
    agents,
  );
  if (handled) {
    return;
  }

  sendJson(response, 404, { status: "not_found" });
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}
