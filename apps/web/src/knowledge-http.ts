import type { IncomingMessage, ServerResponse } from "node:http";
import type { KnowledgeIndexId, KnowledgeSourceId } from "@osva/contracts";
import {
  createKnowledgeIndexRequestSchema,
  createKnowledgeSourceRequestSchema,
  knowledgeRetrieveRequestSchema,
  listKnowledgeSourcesQuerySchema,
  retryKnowledgeIndexRequestSchema,
} from "@osva/contracts/schemas";
import {
  DEFAULT_KNOWLEDGE_INDEX_LIST_LIMIT,
  DEFAULT_KNOWLEDGE_SOURCE_LIST_LIMIT,
  type KnowledgeApplication,
  type KnowledgeRetriever,
} from "@osva/domain";
import {
  toKnowledgeIndexResource,
  toKnowledgeSourceResource,
} from "@osva/domain";

import {
  decodeKnowledgeListCursor,
  encodeKnowledgeListCursor,
} from "./knowledge-cursor.js";
import { requireControlPlaneScope } from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export interface KnowledgeHttpServices {
  readonly knowledge: KnowledgeApplication;
  readonly retriever: KnowledgeRetriever;
}

export async function handleKnowledgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: KnowledgeHttpServices,
): Promise<boolean> {
  const route = matchKnowledgeRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchKnowledgeRoute(
      request,
      response,
      method,
      route,
      searchParams,
      services,
    );
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type KnowledgeRoute =
  | { readonly kind: "sources-collection" }
  | { readonly kind: "source-item"; readonly sourceId: KnowledgeSourceId }
  | {
      readonly kind: "source-indexes";
      readonly sourceId: KnowledgeSourceId;
    }
  | { readonly kind: "index-item"; readonly indexId: KnowledgeIndexId }
  | { readonly kind: "index-retry"; readonly indexId: KnowledgeIndexId }
  | { readonly kind: "retrieve" };

async function dispatchKnowledgeRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: KnowledgeRoute,
  searchParams: URLSearchParams,
  services: KnowledgeHttpServices,
): Promise<void> {
  const scope = requireControlPlaneScope();
  if (route.kind === "sources-collection") {
    if (method === "GET") {
      const parsed = listKnowledgeSourcesQuerySchema.safeParse({
        limit: searchParams.get("limit") ?? undefined,
        cursor: searchParams.get("cursor") ?? undefined,
      });
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }
      const limit = parsed.data.limit
        ? Number.parseInt(parsed.data.limit, 10)
        : DEFAULT_KNOWLEDGE_SOURCE_LIST_LIMIT;
      const decodedCursor =
        parsed.data.cursor === undefined
          ? undefined
          : decodeKnowledgeListCursor(parsed.data.cursor);
      const page = await services.knowledge.listSources.execute(scope, {
        workspaceId: scope.principal.workspaceId,
        limit,
        cursor:
          decodedCursor === undefined
            ? undefined
            : {
                createdAt: decodedCursor.createdAt,
                id: decodedCursor.id as KnowledgeSourceId,
              },
      });
      sendJson(response, 200, {
        items: page.sources.map(toKnowledgeSourceResource),
        nextCursor:
          page.nextCursor === undefined
            ? undefined
            : encodeKnowledgeListCursor(page.nextCursor),
      });
      return;
    }

    if (method === "POST") {
      const parsed = createKnowledgeSourceRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }
      const created = await services.knowledge.createSource.execute(scope, {
        ...parsed.data,
        workspaceId: scope.principal.workspaceId,
      });
      sendJson(response, 201, toKnowledgeSourceResource(created));
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

  if (route.kind === "source-item") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }
    const source = await services.knowledge.getSource.execute(
      scope,
      scope.principal.workspaceId,
      route.sourceId,
    );
    sendJson(response, 200, toKnowledgeSourceResource(source));
    return;
  }

  if (route.kind === "source-indexes") {
    if (method === "GET") {
      const limitParam = searchParams.get("limit");
      const limit = limitParam
        ? Number.parseInt(limitParam, 10)
        : DEFAULT_KNOWLEDGE_INDEX_LIST_LIMIT;
      const cursorParam = searchParams.get("cursor");
      const decodedCursor =
        cursorParam === null || cursorParam.trim().length === 0
          ? undefined
          : decodeKnowledgeListCursor(cursorParam);
      const page = await services.knowledge.listIndexes.execute(scope, {
        workspaceId: scope.principal.workspaceId,
        knowledgeSourceId: route.sourceId,
        limit,
        cursor:
          decodedCursor === undefined
            ? undefined
            : {
                createdAt: decodedCursor.createdAt,
                id: decodedCursor.id as KnowledgeIndexId,
              },
      });
      sendJson(response, 200, {
        items: page.indexes.map(toKnowledgeIndexResource),
        nextCursor:
          page.nextCursor === undefined
            ? undefined
            : encodeKnowledgeListCursor(page.nextCursor),
      });
      return;
    }

    if (method === "POST") {
      const parsed = createKnowledgeIndexRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }
      const created = await services.knowledge.createIndex.execute(scope, {
        workspaceId: scope.principal.workspaceId,
        knowledgeSourceId: route.sourceId,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      sendJson(response, 201, toKnowledgeIndexResource(created));
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

  if (route.kind === "index-item") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }
    const index = await services.knowledge.getIndex.execute(
      scope,
      scope.principal.workspaceId,
      route.indexId,
    );
    sendJson(response, 200, toKnowledgeIndexResource(index));
    return;
  }

  if (route.kind === "index-retry") {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "POST" },
      );
      return;
    }
    const parsed = retryKnowledgeIndexRequestSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
    const retried = await services.knowledge.retryIndex.execute(
      scope,
      scope.principal.workspaceId,
      route.indexId,
    );
    sendJson(response, 200, toKnowledgeIndexResource(retried));
    return;
  }

  if (route.kind === "retrieve") {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "POST" },
      );
      return;
    }
    const parsed = knowledgeRetrieveRequestSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
    const hits = await services.retriever.retrieve({
      ...parsed.data,
      workspaceId: scope.principal.workspaceId,
    });
    sendJson(response, 200, { hits });
    return;
  }
}

function matchKnowledgeRoute(path: string): KnowledgeRoute | undefined {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "v1") {
    return undefined;
  }

  if (segments.length === 2 && segments[1] === "knowledge-sources") {
    return { kind: "sources-collection" };
  }

  if (segments.length === 3 && segments[1] === "knowledge-sources") {
    return {
      kind: "source-item",
      sourceId: segments[2] as KnowledgeSourceId,
    };
  }

  if (
    segments.length === 4 &&
    segments[1] === "knowledge-sources" &&
    segments[3] === "indexes"
  ) {
    return {
      kind: "source-indexes",
      sourceId: segments[2] as KnowledgeSourceId,
    };
  }

  if (segments.length === 3 && segments[1] === "knowledge-indexes") {
    return { kind: "index-item", indexId: segments[2] as KnowledgeIndexId };
  }

  if (
    segments.length === 4 &&
    segments[1] === "knowledge-indexes" &&
    segments[3] === "retry"
  ) {
    return { kind: "index-retry", indexId: segments[2] as KnowledgeIndexId };
  }

  if (
    segments.length === 3 &&
    segments[1] === "knowledge" &&
    segments[2] === "retrieve"
  ) {
    return { kind: "retrieve" };
  }

  return undefined;
}
export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/knowledge-sources" },
  { method: "POST", path: "/v1/knowledge-sources" },
  { method: "GET", path: "/v1/knowledge-sources/:knowledgeSourceId" },
  {
    method: "GET",
    path: "/v1/knowledge-sources/:knowledgeSourceId/indexes",
  },
  {
    method: "POST",
    path: "/v1/knowledge-sources/:knowledgeSourceId/indexes",
  },
  { method: "GET", path: "/v1/knowledge-indexes/:knowledgeIndexId" },
  {
    method: "POST",
    path: "/v1/knowledge-indexes/:knowledgeIndexId/retry",
  },
  { method: "POST", path: "/v1/knowledge/retrieve" },
] as const;
