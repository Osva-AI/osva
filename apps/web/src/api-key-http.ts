import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiKeyId } from "@osva/contracts";
import { createApiKeyRequestSchema } from "@osva/contracts/schemas";
import type { ApiKey, ApiKeyApplication } from "@osva/domain";
import { CONTROL_PLANE_RESOURCE_KINDS } from "@osva/domain";

import {
  authorizeControlPlaneAdmin,
  requireControlPlaneScope,
} from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";
import { emitSecurityEvent, SECURITY_EVENT_NAMES } from "@osva/observability";
import { resolveRequestId } from "./security-request-context.js";

export async function handleApiKeyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  apiKeys: ApiKeyApplication,
): Promise<boolean> {
  const route = matchApiKeyRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchApiKeyRoute(request, response, method, route, apiKeys);
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type ApiKeyRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "revoke"; readonly apiKeyId: ApiKeyId };

function matchApiKeyRoute(path: string): ApiKeyRoute | undefined {
  if (path === "/v1/api-keys") {
    return { kind: "collection" };
  }

  const revokeMatch = /^\/v1\/api-keys\/([^/]+)\/revoke$/.exec(path);
  if (revokeMatch !== null) {
    return {
      kind: "revoke",
      apiKeyId: decodeURIComponent(revokeMatch[1]!) as ApiKeyId,
    };
  }

  return undefined;
}

async function dispatchApiKeyRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: ApiKeyRoute,
  apiKeys: ApiKeyApplication,
): Promise<void> {
  const scope = requireControlPlaneScope();
  const requestId = resolveRequestId();

  if (route.kind === "collection") {
    if (method === "GET") {
      authorizeControlPlaneAdmin(scope, CONTROL_PLANE_RESOURCE_KINDS.apiKey);
      const list = await apiKeys.listWorkspaceApiKeys.execute(scope);
      sendJson(response, 200, toApiKeyListResource(list), {
        "x-osva-request-id": requestId,
      });
      return;
    }

    if (method === "POST") {
      const parsed = createApiKeyRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      authorizeControlPlaneAdmin(scope, CONTROL_PLANE_RESOURCE_KINDS.apiKey);
      const created = await apiKeys.createWorkspaceApiKey.execute(scope, {
        name: parsed.data.name,
        role: parsed.data.role,
        expiresAt:
          parsed.data.expiresAt === undefined
            ? undefined
            : new Date(parsed.data.expiresAt),
      });

      emitSecurityEvent({
        event: SECURITY_EVENT_NAMES.API_KEY_CREATED,
        requestId,
        workspaceId: scope.principal.workspaceId,
        subjectId: scope.principal.subjectId,
        resourceType: CONTROL_PLANE_RESOURCE_KINDS.apiKey,
        resourceId: created.apiKey.id,
        role: created.apiKey.role,
        outcome: "SUCCESS",
      });

      sendJson(
        response,
        201,
        {
          apiKey: toApiKeyResource(created.apiKey),
          token: created.plaintextToken,
        },
        { "x-osva-request-id": requestId },
      );
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST", "x-osva-request-id": requestId },
    );
    return;
  }

  if (method !== "POST") {
    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "POST", "x-osva-request-id": requestId },
    );
    return;
  }

  authorizeControlPlaneAdmin(scope, CONTROL_PLANE_RESOURCE_KINDS.apiKey);
  const revoked = await apiKeys.revokeWorkspaceApiKey.execute(
    scope,
    route.apiKeyId,
  );
  emitSecurityEvent({
    event: SECURITY_EVENT_NAMES.API_KEY_REVOKED,
    requestId,
    workspaceId: scope.principal.workspaceId,
    subjectId: scope.principal.subjectId,
    resourceType: CONTROL_PLANE_RESOURCE_KINDS.apiKey,
    resourceId: revoked.id,
    role: revoked.role,
    outcome: "SUCCESS",
  });
  sendJson(
    response,
    200,
    { apiKey: toApiKeyResource(revoked) },
    { "x-osva-request-id": requestId },
  );
}

function toApiKeyResource(apiKey: ApiKey) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    role: apiKey.role,
    createdAt: apiKey.createdAt.toISOString(),
    expiresAt: apiKey.expiresAt?.toISOString(),
    revokedAt: apiKey.revokedAt?.toISOString(),
  };
}

function toApiKeyListResource(apiKeys: readonly ApiKey[]) {
  return {
    apiKeys: apiKeys.map((apiKey) => toApiKeyResource(apiKey)),
  };
}

export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/api-keys" },
  { method: "POST", path: "/v1/api-keys" },
  { method: "POST", path: "/v1/api-keys/:apiKeyId/revoke" },
] as const;
