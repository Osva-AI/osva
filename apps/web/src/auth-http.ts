import type { IncomingMessage, ServerResponse } from "node:http";

import { PUBLIC_API_ERROR_CODES } from "@osva/contracts";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
} from "@osva/domain";

import {
  authorizeControlPlaneRead,
  requireControlPlaneScope,
} from "./control-plane-http.js";

import { sendHttpError } from "./http-errors.js";
import { sendJson } from "./json.js";
import { resolveRequestId } from "./security-request-context.js";
import { sendV1Error } from "./v1-api-error.js";

export async function handleAuthContextRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
): Promise<boolean> {
  if (path !== "/v1/auth/context") {
    return false;
  }

  const requestId = resolveRequestId();

  if (method !== "GET") {
    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET", "x-osva-request-id": requestId },
    );
    return true;
  }

  try {
    const scope = requireControlPlaneScope();
    authorizeControlPlaneRead(scope, "auth_context");
    const principal = scope.principal;

    sendJson(
      response,
      200,
      {
        subjectId: principal.subjectId,
        workspaceId: principal.workspaceId,
        role: principal.role,
      },
      { "x-osva-request-id": requestId },
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      sendV1Error(
        response,
        401,
        PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
        requestId,
      );
      return true;
    }

    if (error instanceof PermissionDeniedError) {
      sendV1Error(
        response,
        403,
        PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
        requestId,
      );
      return true;
    }

    sendHttpError(response, error);
  }

  return true;
}
export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/auth/context" },
] as const;
