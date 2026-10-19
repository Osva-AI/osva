import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ModelProviderConnectionId,
  ModelProviderConnectionVersionId,
} from "@osva-ai/contracts";
import {
  createModelProviderConnectionRequestSchema,
  createModelProviderConnectionVersionRequestSchema,
  modelProviderConnectionListResourceSchema,
  modelProviderConnectionResourceSchema,
  modelProviderConnectionTestRequestSchema,
  modelProviderConnectionTestResourceSchema,
  modelProviderConnectionVersionListResourceSchema,
  modelProviderConnectionVersionResourceSchema,
  updateModelProviderConnectionRequestSchema,
} from "@osva-ai/contracts/schemas";
import type {
  ModelProviderConnection,
  ModelProviderConnectionApplication,
  ModelProviderConnectionVersion,
} from "@osva/domain";
import { mapModelProviderConnectionVersionToResource } from "@osva/domain";

import {
  requireControlPlaneScope,
  requireControlPlaneWorkspaceId,
} from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export async function handleModelProviderConnectionRegistryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  connections: ModelProviderConnectionApplication,
): Promise<boolean> {
  const route = matchModelProviderConnectionRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchModelProviderConnectionRoute(
      request,
      response,
      method,
      route,
      connections,
    );
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type ModelProviderConnectionRoute =
  | { readonly kind: "collection" }
  | {
      readonly kind: "item";
      readonly connectionId: ModelProviderConnectionId;
    }
  | {
      readonly kind: "versions";
      readonly connectionId: ModelProviderConnectionId;
    }
  | {
      readonly kind: "version";
      readonly connectionId: ModelProviderConnectionId;
      readonly connectionVersionId: ModelProviderConnectionVersionId;
    }
  | {
      readonly kind: "test";
      readonly connectionId: ModelProviderConnectionId;
      readonly connectionVersionId: ModelProviderConnectionVersionId;
    };

async function dispatchModelProviderConnectionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: ModelProviderConnectionRoute,
  connections: ModelProviderConnectionApplication,
): Promise<void> {
  const scope = requireControlPlaneScope();

  if (route.kind === "collection") {
    if (method === "GET") {
      const list =
        await connections.listModelProviderConnections.execute(scope);
      sendJson(response, 200, toConnectionListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createModelProviderConnectionRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await connections.createModelProviderConnection.execute(
        scope,
        {
          ...parsed.data,
          workspaceId: requireControlPlaneWorkspaceId(),
        },
      );
      sendJson(response, 201, toConnectionResource(created));
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
      const connection = await connections.getModelProviderConnection.execute(
        scope,
        route.connectionId,
      );
      sendJson(response, 200, toConnectionResource(connection));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateModelProviderConnectionRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated =
        await connections.updateModelProviderConnectionMetadata.execute(scope, {
          connectionId: route.connectionId,
          name: parsed.data.name,
        });
      sendJson(response, 200, toConnectionResource(updated));
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
      const connection = await connections.getModelProviderConnection.execute(
        scope,
        route.connectionId,
      );
      const versions =
        await connections.listModelProviderConnectionVersions.execute(
          scope,
          route.connectionId,
        );
      sendJson(
        response,
        200,
        toConnectionVersionListResource(connection, versions),
      );
      return;
    }

    if (method === "POST") {
      const parsed =
        createModelProviderConnectionVersionRequestSchema.safeParse(
          await readJsonBody(request),
        );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const connection = await connections.getModelProviderConnection.execute(
        scope,
        route.connectionId,
      );
      const created =
        await connections.appendModelProviderConnectionVersion.execute(scope, {
          connectionId: route.connectionId,
          endpoint: parsed.data.endpoint,
          credentialRef: parsed.data.credentialRef,
        });
      sendJson(response, 201, toConnectionVersionResource(connection, created));
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

  if (route.kind === "test") {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "POST" },
      );
      return;
    }

    const parsed = modelProviderConnectionTestRequestSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }

    const result = await connections.testModelProviderConnectionVersion.execute(
      scope,
      {
        connectionId: route.connectionId,
        connectionVersionId: route.connectionVersionId,
        model: parsed.data.model,
        modelProfileVersionId: parsed.data.modelProfileVersionId,
      },
    );
    sendJson(
      response,
      200,
      modelProviderConnectionTestResourceSchema.parse(result),
    );
    return;
  }

  if (method === "GET") {
    const connection = await connections.getModelProviderConnection.execute(
      scope,
      route.connectionId,
    );
    const version = await connections.getModelProviderConnectionVersion.execute(
      scope,
      {
        connectionId: route.connectionId,
        connectionVersionId: route.connectionVersionId,
      },
    );
    sendJson(response, 200, toConnectionVersionResource(connection, version));
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

function matchModelProviderConnectionRoute(
  path: string,
): ModelProviderConnectionRoute | undefined {
  if (
    path === "/v1/model-provider-connections" ||
    path === "/v1/model-provider-connections/"
  ) {
    return { kind: "collection" };
  }

  if (!path.startsWith("/v1/model-provider-connections/")) {
    return undefined;
  }

  const segments = path
    .slice("/v1/model-provider-connections/".length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length === 1 && segments[0] !== undefined) {
    return {
      kind: "item",
      connectionId: segments[0] as ModelProviderConnectionId,
    };
  }

  if (
    segments.length === 2 &&
    segments[0] !== undefined &&
    segments[1] === "versions"
  ) {
    return {
      kind: "versions",
      connectionId: segments[0] as ModelProviderConnectionId,
    };
  }

  if (
    segments.length === 4 &&
    segments[0] !== undefined &&
    segments[1] === "versions" &&
    segments[2] !== undefined &&
    segments[3] === "test"
  ) {
    return {
      kind: "test",
      connectionId: segments[0] as ModelProviderConnectionId,
      connectionVersionId: segments[2] as ModelProviderConnectionVersionId,
    };
  }

  if (
    segments.length === 3 &&
    segments[0] !== undefined &&
    segments[1] === "versions" &&
    segments[2] !== undefined
  ) {
    return {
      kind: "version",
      connectionId: segments[0] as ModelProviderConnectionId,
      connectionVersionId: segments[2] as ModelProviderConnectionVersionId,
    };
  }

  return undefined;
}

function toConnectionResource(connection: ModelProviderConnection) {
  return modelProviderConnectionResourceSchema.parse({
    id: connection.id,
    workspaceId: connection.workspaceId,
    key: connection.key,
    name: connection.name,
    provider: connection.provider,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  });
}

function toConnectionListResource(
  connections: readonly ModelProviderConnection[],
) {
  return modelProviderConnectionListResourceSchema.parse({
    connections: connections.map((connection) => ({
      id: connection.id,
      workspaceId: connection.workspaceId,
      key: connection.key,
      name: connection.name,
      provider: connection.provider,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    })),
  });
}

function toConnectionVersionResource(
  connection: ModelProviderConnection,
  version: ModelProviderConnectionVersion,
) {
  return modelProviderConnectionVersionResourceSchema.parse(
    mapModelProviderConnectionVersionToResource({ connection, version }),
  );
}

function toConnectionVersionListResource(
  connection: ModelProviderConnection,
  versions: readonly ModelProviderConnectionVersion[],
) {
  return modelProviderConnectionVersionListResourceSchema.parse({
    versions: versions.map((version) =>
      mapModelProviderConnectionVersionToResource({ connection, version }),
    ),
  });
}

export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/model-provider-connections" },
  { method: "POST", path: "/v1/model-provider-connections" },
  {
    method: "GET",
    path: "/v1/model-provider-connections/:connectionId",
  },
  {
    method: "PATCH",
    path: "/v1/model-provider-connections/:connectionId",
  },
  {
    method: "GET",
    path: "/v1/model-provider-connections/:connectionId/versions",
  },
  {
    method: "POST",
    path: "/v1/model-provider-connections/:connectionId/versions",
  },
  {
    method: "GET",
    path: "/v1/model-provider-connections/:connectionId/versions/:connectionVersionId",
  },
  {
    method: "POST",
    path: "/v1/model-provider-connections/:connectionId/versions/:connectionVersionId/test",
  },
] as const;
