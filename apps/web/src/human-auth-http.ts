import type { IncomingMessage, ServerResponse } from "node:http";

import {
  AUTHENTICATION_METHODS,
  HUMAN_AUTH_ROUTE_IDS,
  OSVA_WORKSPACE_ID_HEADER,
  PUBLIC_API_ERROR_CODES,
  type UserId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import {
  IdentityApplication,
  PermissionDeniedError,
  WorkspaceSelectionRequiredError,
  authorizeHumanRoute,
  type HumanAuthenticationService,
  type SecurityAuditEventRepository,
  type UserRepository,
  type WorkspaceMembershipRepository,
  type WorkspaceRepository,
} from "@osva/domain";

import { assertTrustedOrigin } from "./human-auth-csrf.js";
import { readJsonBody } from "./json.js";
import { sendHttpError } from "./http-errors.js";
import { sendJson } from "./json.js";
import {
  getRequestPrincipal,
  resolveRequestId,
} from "./security-request-context.js";
import { sendV1Error } from "./v1-api-error.js";
import {
  readSessionTokenFromCookieHeader,
  sessionHeadersFromIncoming,
} from "@osva/adapters-auth";
import type { OsvaBetterAuth } from "@osva/adapters-auth";
import { isHumanSessionRequestPrincipal } from "@osva-ai/contracts";

import type { HumanOperatorPasswordTokenService } from "@osva/domain";

import {
  assertWorkspaceHeaderMatchesPath,
  mapHumanMembershipError,
  tryHandleHumanMembershipRequest,
} from "./human-membership-http.js";

export interface HumanAuthHttpServices {
  readonly auth: OsvaBetterAuth;
  readonly humanAuthentication: HumanAuthenticationService;
  readonly identity: IdentityApplication;
  readonly users: UserRepository;
  readonly workspaces: WorkspaceRepository;
  readonly workspaceMemberships: WorkspaceMembershipRepository;
  readonly securityAuditEvents: SecurityAuditEventRepository;
  readonly trustedOrigins: readonly string[];
  readonly passwordTokens: HumanOperatorPasswordTokenService;
  readonly setupCompleteRedirectUrl: string;
}

export function isHumanAuthRoutePath(path: string): boolean {
  if (path === "/v1/me/workspaces") {
    return true;
  }
  return path.startsWith("/v1/auth/") && path !== "/v1/auth/context";
}

export async function handleHumanAuthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  services: HumanAuthHttpServices,
): Promise<boolean> {
  if (!isHumanAuthRoutePath(path)) {
    return false;
  }

  const requestId = resolveRequestId();

  try {
    if (
      method !== "GET" &&
      !assertTrustedOrigin(request, services.trustedOrigins)
    ) {
      sendV1Error(
        response,
        403,
        PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
        requestId,
      );
      return true;
    }

    if (path === "/v1/auth/login" && method === "POST") {
      await handleLogin(request, response, services, requestId);
      return true;
    }

    if (path === "/v1/auth/logout" && method === "POST") {
      await handleLogout(request, response, services, requestId);
      return true;
    }

    if (path === "/v1/auth/session" && method === "GET") {
      await handleSession(request, response, services, requestId);
      return true;
    }

    if (
      (path === "/v1/auth/setup/complete" || path === "/v1/auth/setup") &&
      method === "POST"
    ) {
      await handleSetupComplete(request, response, services, requestId);
      return true;
    }

    if (
      (path === "/v1/auth/recovery/complete" ||
        path === "/v1/auth/recovery/reset") &&
      method === "POST"
    ) {
      await handleRecoveryComplete(request, response, services, requestId);
      return true;
    }

    if (path === "/v1/auth/me" && method === "GET") {
      await handleMe(request, response, services, requestId);
      return true;
    }

    if (
      (path === "/v1/me/workspaces" || path === "/v1/auth/workspaces") &&
      method === "GET"
    ) {
      await handleListWorkspaces(request, response, services, requestId);
      return true;
    }

    if (path === "/v1/auth/workspaces/select" && method === "POST") {
      await handleWorkspaceSelect(request, response, services, requestId);
      return true;
    }

    const membershipsMatch =
      /^\/v1\/auth\/workspaces\/([^/]+)\/memberships$/.exec(path);
    if (membershipsMatch !== null && method === "GET") {
      await handleListMemberships(
        request,
        response,
        services,
        requestId,
        membershipsMatch[1] as WorkspaceId,
      );
      return true;
    }

    if (path === "/v1/auth/audit-events" && method === "GET") {
      await handleAuditEvents(request, response, services, requestId);
      return true;
    }

    if (
      await tryHandleHumanMembershipRequest(
        request,
        response,
        method,
        path,
        services,
        requestId,
      )
    ) {
      return true;
    }

    sendJson(
      response,
      404,
      { status: "not_found" },
      { "x-osva-request-id": requestId },
    );
  } catch (error) {
    if (mapHumanMembershipError(response, error, requestId)) {
      return true;
    }
    if (error instanceof WorkspaceSelectionRequiredError) {
      sendV1Error(
        response,
        400,
        PUBLIC_API_ERROR_CODES.WORKSPACE_SELECTION_REQUIRED,
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

async function handleLogin(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<void> {
  const body = (await readJsonBody(request)) as {
    email?: string;
    password?: string;
  };
  const result = await services.humanAuthentication.signInWithEmail({
    email: body.email ?? "",
    password: body.password ?? "",
  });

  response.setHeader(
    "set-cookie",
    buildSessionCookie(result.sessionToken, result.expiresAt),
  );
  sendJson(
    response,
    200,
    {
      userId: result.userId,
      expiresAt: result.expiresAt.toISOString(),
    },
    { "x-osva-request-id": requestId },
  );
}

async function handleLogout(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<void> {
  const token = readSessionTokenFromCookieHeader(request.headers.cookie);
  if (token !== undefined) {
    await services.humanAuthentication.signOut(token);
  }
  response.setHeader("set-cookie", clearSessionCookie());
  response.statusCode = 204;
  response.setHeader("x-osva-request-id", requestId);
  response.end();
}

async function handleSession(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<void> {
  const token = readSessionTokenFromCookieHeader(request.headers.cookie);
  if (token === undefined) {
    sendV1Error(
      response,
      401,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      requestId,
    );
    return;
  }

  const session = await services.humanAuthentication.getSession(token);
  if (session === null) {
    response.setHeader("set-cookie", clearSessionCookie());
    sendV1Error(
      response,
      401,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      requestId,
    );
    return;
  }

  sendJson(
    response,
    200,
    {
      userId: session.userId,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt.toISOString(),
    },
    { "x-osva-request-id": requestId },
  );
}

async function handleSetupComplete(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<void> {
  const body = (await readJsonBody(request)) as {
    token?: string;
    password?: string;
    newPassword?: string;
  };
  const password = body.password ?? body.newPassword ?? "";
  try {
    await services.humanAuthentication.completeInitialSetupWithToken({
      token: body.token ?? "",
      newPassword: password,
    });
  } catch {
    sendV1Error(
      response,
      400,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      requestId,
    );
    return;
  }

  sendJson(response, 200, { status: "ok" }, { "x-osva-request-id": requestId });
}

async function handleRecoveryComplete(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<void> {
  const body = (await readJsonBody(request)) as {
    token?: string;
    password?: string;
    newPassword?: string;
  };
  const password = body.password ?? body.newPassword ?? "";
  try {
    await services.humanAuthentication.resetPassword({
      token: body.token ?? "",
      newPassword: password,
    });
  } catch {
    sendV1Error(
      response,
      400,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      requestId,
    );
    return;
  }

  sendJson(response, 200, { status: "ok" }, { "x-osva-request-id": requestId });
}

async function handleMe(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<void> {
  const userId = await requireHumanUserId(
    request,
    response,
    services,
    requestId,
  );
  if (userId === undefined) {
    return;
  }
  const user = await services.users.findById(userId);
  if (user === null) {
    sendV1Error(
      response,
      404,
      PUBLIC_API_ERROR_CODES.RESOURCE_NOT_FOUND,
      requestId,
    );
    return;
  }

  sendJson(
    response,
    200,
    {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
    },
    { "x-osva-request-id": requestId },
  );
}

async function handleListWorkspaces(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<void> {
  const userId = await requireHumanUserId(
    request,
    response,
    services,
    requestId,
  );
  if (userId === undefined) {
    return;
  }

  const memberships = await services.workspaceMemberships.listByUserId(userId);
  const workspaces = [];
  for (const membership of memberships) {
    const workspace = await services.workspaces.findById(
      membership.workspaceId,
    );
    if (workspace === null) {
      continue;
    }
    workspaces.push({
      workspaceId: workspace.id,
      name: workspace.name,
      role: membership.role,
    });
  }

  sendJson(response, 200, { workspaces }, { "x-osva-request-id": requestId });
}

async function handleWorkspaceSelect(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<void> {
  const userId = await requireHumanUserId(
    request,
    response,
    services,
    requestId,
  );
  if (userId === undefined) {
    return;
  }
  const body = (await readJsonBody(request)) as { workspaceId?: string };
  const workspaceId = body.workspaceId as WorkspaceId | undefined;
  if (workspaceId === undefined) {
    sendV1Error(
      response,
      400,
      PUBLIC_API_ERROR_CODES.WORKSPACE_SELECTION_REQUIRED,
      requestId,
    );
    return;
  }

  const membership = await services.workspaceMemberships.findByWorkspaceAndUser(
    workspaceId,
    userId,
  );
  if (membership === null) {
    sendV1Error(
      response,
      403,
      PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
      requestId,
    );
    return;
  }

  sendJson(
    response,
    200,
    { workspaceId, role: membership.role },
    { "x-osva-request-id": requestId },
  );
}

async function handleListMemberships(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
  workspaceId: WorkspaceId,
): Promise<void> {
  assertWorkspaceHeaderMatchesPath(request, workspaceId);
  await authorizeHumanRoute(
    {
      users: services.users,
      workspaceMemberships: services.workspaceMemberships,
    },
    {
      principal: getRequestPrincipal(),
      routeId: HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBERSHIPS_LIST,
      workspaceId,
    },
  );

  const memberships =
    await services.workspaceMemberships.listByWorkspaceId(workspaceId);

  sendJson(
    response,
    200,
    {
      memberships: memberships.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        role: membership.role,
      })),
    },
    { "x-osva-request-id": requestId },
  );
}

async function handleAuditEvents(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<void> {
  const principal = getRequestPrincipal();
  const workspaceId = readWorkspaceHeader(request);
  await authorizeHumanRoute(
    {
      users: services.users,
      workspaceMemberships: services.workspaceMemberships,
    },
    {
      principal,
      routeId: HUMAN_AUTH_ROUTE_IDS.AUDIT_EVENTS_LIST,
      workspaceId,
    },
  );

  const events = await services.securityAuditEvents.listForWorkspace(
    workspaceId!,
    50,
  );
  sendJson(
    response,
    200,
    {
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        details: event.details,
      })),
    },
    { "x-osva-request-id": requestId },
  );
}

async function requireHumanUserId(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<UserId | undefined> {
  const token = requireSessionToken(request, response, requestId);
  if (token === undefined) {
    return undefined;
  }
  const session = await services.humanAuthentication.getSession(token);
  if (session === null) {
    sendV1Error(
      response,
      401,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      requestId,
    );
    return undefined;
  }
  return session.userId;
}

function requireSessionToken(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
): string | undefined {
  const token = readSessionTokenFromCookieHeader(request.headers.cookie);
  if (token === undefined) {
    sendV1Error(
      response,
      401,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      requestId,
    );
    return undefined;
  }
  return token;
}

function readWorkspaceHeader(
  request: IncomingMessage,
): WorkspaceId | undefined {
  const raw = request.headers[OSVA_WORKSPACE_ID_HEADER.toLowerCase()];
  if (typeof raw === "string" && raw.length > 0) {
    return raw as WorkspaceId;
  }
  const principal = getRequestPrincipal();
  if (
    principal !== undefined &&
    isHumanSessionRequestPrincipal(principal) &&
    principal.workspaceId !== undefined
  ) {
    return principal.workspaceId;
  }
  return undefined;
}

function buildSessionCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  return `osva.session_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}`;
}

function clearSessionCookie(): string {
  return "osva.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

export async function resolveHumanSessionPrincipal(
  request: IncomingMessage,
  services: HumanAuthHttpServices,
): Promise<import("@osva-ai/contracts").HumanSessionRequestPrincipal | null> {
  const token = readSessionTokenFromCookieHeader(request.headers.cookie);
  if (token === undefined) {
    return null;
  }
  const session = await services.humanAuthentication.getSession(token);
  if (session === null) {
    return null;
  }

  const workspaceId = readWorkspaceHeader(request);
  return {
    authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
    userId: session.userId,
    sessionId: session.sessionId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
}

export { sessionHeadersFromIncoming };

export { V1_HUMAN_AUTH_HTTP_ROUTES as V1_HTTP_ROUTES } from "./v1-route-human-access-inventory.js";
