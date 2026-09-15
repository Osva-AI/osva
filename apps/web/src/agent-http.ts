import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentId, AgentVersionId } from "@osva/contracts";
import {
  agentListResourceSchema,
  agentResourceSchema,
  agentVersionListResourceSchema,
  agentVersionResourceSchema,
  createAgentRequestSchema,
  createAgentVersionRequestSchema,
  updateAgentRequestSchema,
} from "@osva/contracts/schemas";
import type { Agent, AgentApplication, AgentVersion } from "@osva/domain";

import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export async function handleAgentRegistryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  agents: AgentApplication,
): Promise<boolean> {
  const route = matchAgentRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchAgentRoute(request, response, method, route, agents);
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type AgentRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly agentId: AgentId }
  | { readonly kind: "versions"; readonly agentId: AgentId }
  | {
      readonly kind: "version";
      readonly agentId: AgentId;
      readonly agentVersionId: AgentVersionId;
    };

async function dispatchAgentRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: AgentRoute,
  agents: AgentApplication,
): Promise<void> {
  if (route.kind === "collection") {
    if (method === "GET") {
      const list = await agents.listAgents.execute();
      sendJson(response, 200, toAgentListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createAgentRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await agents.createAgent.execute(parsed.data);
      sendJson(response, 201, toAgentResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "item") {
    if (method === "GET") {
      const agent = await agents.getAgent.execute(route.agentId);
      sendJson(response, 200, toAgentResource(agent));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateAgentRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await agents.updateAgentMetadata.execute({
        agentId: route.agentId,
        name: parsed.data.name,
      });
      sendJson(response, 200, toAgentResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, PATCH" },
    );
    return;
  }

  if (route.kind === "versions") {
    if (method === "GET") {
      const versions = await agents.listAgentVersions.execute(route.agentId);
      sendJson(response, 200, toAgentVersionListResource(versions));
      return;
    }

    if (method === "POST") {
      const parsed = createAgentVersionRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await agents.appendAgentVersion.execute({
        agentId: route.agentId,
        manifest: parsed.data.manifest,
      });
      sendJson(response, 201, toAgentVersionResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (method === "GET") {
    const version = await agents.getAgentVersion.execute({
      agentId: route.agentId,
      agentVersionId: route.agentVersionId,
    });
    sendJson(response, 200, toAgentVersionResource(version));
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

function matchAgentRoute(path: string): AgentRoute | undefined {
  if (path === "/v1/agents" || path === "/v1/agents/") {
    return { kind: "collection" };
  }

  if (!path.startsWith("/v1/agents/")) {
    return undefined;
  }

  const segments = path
    .slice("/v1/agents/".length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length === 1 && segments[0] !== undefined) {
    return { kind: "item", agentId: segments[0] as AgentId };
  }

  if (
    segments.length === 2 &&
    segments[0] !== undefined &&
    segments[1] === "versions"
  ) {
    return { kind: "versions", agentId: segments[0] as AgentId };
  }

  if (
    segments.length === 3 &&
    segments[0] !== undefined &&
    segments[1] === "versions" &&
    segments[2] !== undefined
  ) {
    return {
      kind: "version",
      agentId: segments[0] as AgentId,
      agentVersionId: segments[2] as AgentVersionId,
    };
  }

  return undefined;
}

function toAgentResource(agent: Agent) {
  return agentResourceSchema.parse({
    id: agent.id,
    workspaceId: agent.workspaceId,
    key: agent.key,
    name: agent.name,
    createdAt: agent.createdAt.toISOString(),
  });
}

function toAgentListResource(agents: readonly Agent[]) {
  return agentListResourceSchema.parse({
    agents: agents.map((agent) => ({
      id: agent.id,
      workspaceId: agent.workspaceId,
      key: agent.key,
      name: agent.name,
      createdAt: agent.createdAt.toISOString(),
    })),
  });
}

function toAgentVersionResource(version: AgentVersion) {
  return agentVersionResourceSchema.parse({
    id: version.id,
    agentId: version.agentId,
    version: version.version,
    manifest: version.manifest,
    createdAt: version.createdAt.toISOString(),
  });
}

function toAgentVersionListResource(versions: readonly AgentVersion[]) {
  return agentVersionListResourceSchema.parse({
    versions: versions.map((version) => ({
      id: version.id,
      agentId: version.agentId,
      version: version.version,
      manifest: version.manifest,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}
