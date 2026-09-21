import type { IncomingMessage, ServerResponse } from "node:http";
import type { MemoryNamespaceId } from "@osva/contracts";
import {
  createMemoryNamespaceRequestSchema,
  memoryNamespaceListResourceSchema,
  memoryNamespaceResourceSchema,
  memoryRecordListResourceSchema,
} from "@osva/contracts/schemas";
import {
  DEFAULT_MEMORY_RECORD_LIST_LIMIT,
  MAX_MEMORY_RECORD_LIST_LIMIT,
  type MemoryApplication,
  type MemoryNamespace,
  type MemoryRecord,
} from "@osva/domain";

import { requireControlPlaneScope } from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export async function handleMemoryRegistryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  memory: MemoryApplication,
): Promise<boolean> {
  const route = matchMemoryRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchMemoryRoute(
      request,
      response,
      method,
      route,
      searchParams,
      memory,
    );
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type MemoryRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly namespaceId: MemoryNamespaceId }
  | { readonly kind: "records"; readonly namespaceId: MemoryNamespaceId };

async function dispatchMemoryRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: MemoryRoute,
  searchParams: URLSearchParams,
  memory: MemoryApplication,
): Promise<void> {
  const scope = requireControlPlaneScope();
  if (route.kind === "collection") {
    if (method === "GET") {
      const list = await memory.listMemoryNamespaces.execute(scope);
      sendJson(response, 200, toMemoryNamespaceListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createMemoryNamespaceRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await memory.createMemoryNamespace.execute(scope, {
        ...parsed.data,
        workspaceId: scope.principal.workspaceId,
      });
      sendJson(response, 201, toMemoryNamespaceResource(created));
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
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }

    const namespace = await memory.getMemoryNamespace.execute(
      scope,
      route.namespaceId,
    );
    sendJson(response, 200, toMemoryNamespaceResource(namespace));
    return;
  }

  if (method !== "GET") {
    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  const limitRaw = searchParams.get("limit");
  const limit =
    limitRaw === null
      ? DEFAULT_MEMORY_RECORD_LIST_LIMIT
      : Number.parseInt(limitRaw, 10);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_MEMORY_RECORD_LIST_LIMIT
  ) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  const records = await memory.listMemoryRecords.execute(scope, {
    namespaceId: route.namespaceId,
    prefix: searchParams.get("prefix") ?? undefined,
    limit,
    cursor: searchParams.get("cursor") ?? undefined,
  });

  sendJson(
    response,
    200,
    toMemoryRecordListResource(records.records, records.nextCursor),
  );
}

function matchMemoryRoute(path: string): MemoryRoute | undefined {
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (
    segments.length === 3 &&
    segments[0] === "v1" &&
    segments[1] === "memory" &&
    segments[2] === "namespaces"
  ) {
    return { kind: "collection" };
  }

  if (
    segments.length === 4 &&
    segments[0] === "v1" &&
    segments[1] === "memory" &&
    segments[2] === "namespaces"
  ) {
    return {
      kind: "item",
      namespaceId: decodeURIComponent(segments[3]!) as MemoryNamespaceId,
    };
  }

  if (
    segments.length === 5 &&
    segments[0] === "v1" &&
    segments[1] === "memory" &&
    segments[2] === "namespaces" &&
    segments[4] === "records"
  ) {
    return {
      kind: "records",
      namespaceId: decodeURIComponent(segments[3]!) as MemoryNamespaceId,
    };
  }

  return undefined;
}

function toMemoryNamespaceResource(namespace: MemoryNamespace) {
  return memoryNamespaceResourceSchema.parse({
    id: namespace.id,
    workspaceId: namespace.workspaceId,
    key: namespace.key,
    name: namespace.name,
    description: namespace.description,
    createdAt: namespace.createdAt.toISOString(),
    updatedAt: namespace.updatedAt.toISOString(),
  });
}

function toMemoryNamespaceListResource(items: readonly MemoryNamespace[]) {
  return memoryNamespaceListResourceSchema.parse({
    items: items.map((namespace) => toMemoryNamespaceResource(namespace)),
  });
}

function toMemoryRecordListResource(
  records: readonly MemoryRecord[],
  nextCursor?: string,
) {
  return memoryRecordListResourceSchema.parse({
    items: records.map((record) => ({
      key: record.key,
      value: record.value,
      revision: record.revision,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })),
    nextCursor,
  });
}
export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/memory/namespaces" },
  { method: "POST", path: "/v1/memory/namespaces" },
  { method: "GET", path: "/v1/memory/namespaces/:namespaceId" },
  { method: "GET", path: "/v1/memory/namespaces/:namespaceId/records" },
] as const;
