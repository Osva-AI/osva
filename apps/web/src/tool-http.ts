import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolId, ToolVersionId } from "@osva/contracts";
import {
  createToolRequestSchema,
  createToolVersionRequestSchema,
  toolListResourceSchema,
  toolResourceSchema,
  toolVersionListResourceSchema,
  toolVersionResourceSchema,
  updateToolRequestSchema,
} from "@osva/contracts/schemas";
import type { Tool, ToolApplication, ToolVersion } from "@osva/domain";

import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export async function handleToolRegistryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  tools: ToolApplication,
): Promise<boolean> {
  const route = matchToolRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchToolRoute(request, response, method, route, tools);
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type ToolRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly toolId: ToolId }
  | { readonly kind: "versions"; readonly toolId: ToolId }
  | {
      readonly kind: "version";
      readonly toolId: ToolId;
      readonly toolVersionId: ToolVersionId;
    };

async function dispatchToolRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: ToolRoute,
  tools: ToolApplication,
): Promise<void> {
  if (route.kind === "collection") {
    if (method === "GET") {
      const list = await tools.listTools.execute();
      sendJson(response, 200, toToolListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createToolRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await tools.createTool.execute(parsed.data);
      sendJson(response, 201, toToolResource(created));
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
      const tool = await tools.getTool.execute(route.toolId);
      sendJson(response, 200, toToolResource(tool));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateToolRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await tools.updateToolMetadata.execute({
        toolId: route.toolId,
        name: parsed.data.name,
      });
      sendJson(response, 200, toToolResource(updated));
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
      const versions = await tools.listToolVersions.execute(route.toolId);
      sendJson(response, 200, toToolVersionListResource(versions));
      return;
    }

    if (method === "POST") {
      const parsed = createToolVersionRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await tools.appendToolVersion.execute({
        toolId: route.toolId,
        type: parsed.data.type,
        implementation: parsed.data.implementation,
      });
      sendJson(response, 201, toToolVersionResource(created));
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
    const version = await tools.getToolVersion.execute({
      toolId: route.toolId,
      toolVersionId: route.toolVersionId,
    });
    sendJson(response, 200, toToolVersionResource(version));
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

function matchToolRoute(path: string): ToolRoute | undefined {
  if (path === "/v1/tools" || path === "/v1/tools/") {
    return { kind: "collection" };
  }

  if (!path.startsWith("/v1/tools/")) {
    return undefined;
  }

  const segments = path
    .slice("/v1/tools/".length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length === 1 && segments[0] !== undefined) {
    return { kind: "item", toolId: segments[0] as ToolId };
  }

  if (
    segments.length === 2 &&
    segments[0] !== undefined &&
    segments[1] === "versions"
  ) {
    return { kind: "versions", toolId: segments[0] as ToolId };
  }

  if (
    segments.length === 3 &&
    segments[0] !== undefined &&
    segments[1] === "versions" &&
    segments[2] !== undefined
  ) {
    return {
      kind: "version",
      toolId: segments[0] as ToolId,
      toolVersionId: segments[2] as ToolVersionId,
    };
  }

  return undefined;
}

function toToolResource(tool: Tool) {
  return toolResourceSchema.parse({
    id: tool.id,
    workspaceId: tool.workspaceId,
    key: tool.key,
    name: tool.name,
    createdAt: tool.createdAt.toISOString(),
  });
}

function toToolListResource(items: readonly Tool[]) {
  return toolListResourceSchema.parse({
    tools: items.map((tool) => ({
      id: tool.id,
      workspaceId: tool.workspaceId,
      key: tool.key,
      name: tool.name,
      createdAt: tool.createdAt.toISOString(),
    })),
  });
}

function toToolVersionResource(version: ToolVersion) {
  return toolVersionResourceSchema.parse({
    id: version.id,
    toolId: version.toolId,
    version: version.version,
    type: version.type,
    implementation: version.implementation,
    createdAt: version.createdAt.toISOString(),
  });
}

function toToolVersionListResource(versions: readonly ToolVersion[]) {
  return toolVersionListResourceSchema.parse({
    versions: versions.map((version) => ({
      id: version.id,
      toolId: version.toolId,
      version: version.version,
      type: version.type,
      implementation: version.implementation,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}
