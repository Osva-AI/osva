import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  AUTHENTICATION_METHODS,
  HUMAN_AUTH_ROUTE_IDS,
  OSVA_WORKSPACE_ID_HEADER,
  PUBLIC_API_ERROR_CODES,
  SECURITY_AUDIT_EVENT_TYPES,
  addWorkspaceMembershipRequestSchema,
  changeWorkspaceMembershipRoleRequestSchema,
  provisionWorkspaceMemberRequestSchema,
  transferWorkspaceOwnershipRequestSchema,
  type SecurityAuditEventId,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipId,
} from "@osva-ai/contracts";
import {
  DuplicateUserEmailError,
  DuplicateWorkspaceMembershipError,
  DomainInvariantError,
  PermissionDeniedError,
  SecurityAuditEvent,
  UserNotFoundError,
  WorkspaceMembershipNotFoundError,
  WorkspaceOwnerInvariantError,
  authorizeHumanRoute,
} from "@osva/domain";

import { readJsonBody, sendJson } from "./json.js";
import type { HumanAuthHttpServices } from "./human-auth-http.js";

export type HumanMembershipHttpServices = HumanAuthHttpServices;
import { getRequestPrincipal } from "./security-request-context.js";
import { sendV1Error } from "./v1-api-error.js";

export async function tryHandleHumanMembershipRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  services: HumanMembershipHttpServices,
  requestId: string,
): Promise<boolean> {
  const membershipsCollection =
    /^\/v1\/auth\/workspaces\/([^/]+)\/memberships$/.exec(path);
  if (membershipsCollection !== null) {
    const workspaceId = membershipsCollection[1] as WorkspaceId;
    if (method === "POST") {
      await handleAddMembership(
        request,
        response,
        services,
        requestId,
        workspaceId,
      );
      return true;
    }
  }

  const membersUsers = /^\/v1\/auth\/workspaces\/([^/]+)\/members\/users$/.exec(
    path,
  );
  if (membersUsers !== null && method === "POST") {
    await handleProvisionMember(
      request,
      response,
      services,
      requestId,
      membersUsers[1] as WorkspaceId,
    );
    return true;
  }

  const grantOwner =
    /^\/v1\/auth\/workspaces\/([^/]+)\/memberships\/([^/]+)\/grant-owner$/.exec(
      path,
    );
  if (grantOwner !== null && method === "POST") {
    await handleGrantOwner(
      request,
      response,
      services,
      requestId,
      grantOwner[1] as WorkspaceId,
      grantOwner[2] as WorkspaceMembershipId,
    );
    return true;
  }

  const membershipItem =
    /^\/v1\/auth\/workspaces\/([^/]+)\/memberships\/([^/]+)$/.exec(path);
  if (membershipItem !== null) {
    const workspaceId = membershipItem[1] as WorkspaceId;
    const membershipId = membershipItem[2] as WorkspaceMembershipId;
    if (method === "PATCH") {
      await handleChangeMembershipRole(
        request,
        response,
        services,
        requestId,
        workspaceId,
        membershipId,
      );
      return true;
    }
    if (method === "DELETE") {
      await handleRemoveMembership(
        request,
        response,
        services,
        requestId,
        workspaceId,
        membershipId,
      );
      return true;
    }
  }

  const transferOwnership =
    /^\/v1\/auth\/workspaces\/([^/]+)\/ownership\/transfer$/.exec(path);
  if (transferOwnership !== null && method === "POST") {
    await handleTransferOwnership(
      request,
      response,
      services,
      requestId,
      transferOwnership[1] as WorkspaceId,
    );
    return true;
  }

  return false;
}

export function mapHumanMembershipError(
  response: ServerResponse,
  error: unknown,
  requestId: string,
): boolean {
  if (error instanceof PermissionDeniedError) {
    sendV1Error(
      response,
      403,
      PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
      requestId,
    );
    return true;
  }
  if (error instanceof WorkspaceMembershipNotFoundError) {
    sendV1Error(
      response,
      404,
      PUBLIC_API_ERROR_CODES.RESOURCE_NOT_FOUND,
      requestId,
    );
    return true;
  }
  if (error instanceof UserNotFoundError) {
    sendV1Error(
      response,
      404,
      PUBLIC_API_ERROR_CODES.RESOURCE_NOT_FOUND,
      requestId,
    );
    return true;
  }
  if (
    error instanceof DuplicateWorkspaceMembershipError ||
    error instanceof DuplicateUserEmailError
  ) {
    sendJson(
      response,
      409,
      { status: "conflict" },
      { "x-osva-request-id": requestId },
    );
    return true;
  }
  if (
    error instanceof WorkspaceOwnerInvariantError ||
    error instanceof DomainInvariantError
  ) {
    sendV1Error(
      response,
      403,
      PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
      requestId,
    );
    return true;
  }
  return false;
}

async function requireActorUserId(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanAuthHttpServices,
  requestId: string,
): Promise<UserId | undefined> {
  const principal = getRequestPrincipal();
  if (
    principal === undefined ||
    principal.authenticationMethod !== AUTHENTICATION_METHODS.HUMAN_SESSION
  ) {
    sendV1Error(
      response,
      401,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      requestId,
    );
    return undefined;
  }
  return principal.userId;
}

async function authorizeMembershipRoute(
  services: HumanAuthHttpServices,
  routeId: (typeof HUMAN_AUTH_ROUTE_IDS)[keyof typeof HUMAN_AUTH_ROUTE_IDS],
  workspaceId: WorkspaceId,
): Promise<void> {
  await authorizeHumanRoute(
    {
      users: services.users,
      workspaceMemberships: services.workspaceMemberships,
    },
    {
      principal: getRequestPrincipal(),
      routeId,
      workspaceId,
    },
  );
}

async function handleAddMembership(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanMembershipHttpServices,
  requestId: string,
  workspaceId: WorkspaceId,
): Promise<void> {
  const actorUserId = await requireActorUserId(
    request,
    response,
    services,
    requestId,
  );
  if (actorUserId === undefined) {
    return;
  }

  assertWorkspaceHeaderMatchesPath(request, workspaceId);

  await authorizeMembershipRoute(
    services,
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBERSHIP_CREATE,
    workspaceId,
  );

  const body = addWorkspaceMembershipRequestSchema.parse(
    await readJsonBody(request),
  );

  const membership =
    await services.identity.addExistingUserToWorkspaceMembership({
      workspaceId,
      userId: body.userId as UserId,
      role: body.role,
      actorUserId,
    });

  sendJson(
    response,
    201,
    {
      membership: {
        id: membership.id,
        userId: membership.userId,
        role: membership.role,
      },
    },
    { "x-osva-request-id": requestId },
  );
}

async function handleProvisionMember(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanMembershipHttpServices,
  requestId: string,
  workspaceId: WorkspaceId,
): Promise<void> {
  const actorUserId = await requireActorUserId(
    request,
    response,
    services,
    requestId,
  );
  if (actorUserId === undefined) {
    return;
  }

  assertWorkspaceHeaderMatchesPath(request, workspaceId);

  await authorizeMembershipRoute(
    services,
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBER_PROVISION,
    workspaceId,
  );

  const body = provisionWorkspaceMemberRequestSchema.parse(
    await readJsonBody(request),
  );

  const user = await services.identity.provisionPendingWorkspaceMember({
    workspaceId,
    email: body.email,
    displayName: body.displayName,
    role: body.role,
    actorUserId,
  });

  const issued = await services.passwordTokens.issuePasswordResetToken({
    email: user.email,
    redirectTo: services.setupCompleteRedirectUrl,
  });

  await services.securityAuditEvents.append(
    SecurityAuditEvent.create({
      id: randomUUID() as SecurityAuditEventId,
      eventType: SECURITY_AUDIT_EVENT_TYPES.USER_PASSWORD_RESET_REQUESTED,
      occurredAt: new Date(),
      workspaceId,
      actorUserId,
      details: { purpose: "workspace_member_setup", userId: user.id },
    }),
  );

  sendJson(
    response,
    201,
    {
      user: {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
      },
      membershipRole: body.role,
      setupToken: issued.token,
    },
    { "x-osva-request-id": requestId },
  );
}

async function handleChangeMembershipRole(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanMembershipHttpServices,
  requestId: string,
  workspaceId: WorkspaceId,
  membershipId: WorkspaceMembershipId,
): Promise<void> {
  const actorUserId = await requireActorUserId(
    request,
    response,
    services,
    requestId,
  );
  if (actorUserId === undefined) {
    return;
  }

  assertWorkspaceHeaderMatchesPath(request, workspaceId);

  await authorizeMembershipRoute(
    services,
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBERSHIP_UPDATE,
    workspaceId,
  );

  const body = changeWorkspaceMembershipRoleRequestSchema.parse(
    await readJsonBody(request),
  );

  const membership =
    await services.identity.changeNonOwnerWorkspaceMembershipRole({
      workspaceId,
      membershipId,
      role: body.role,
      actorUserId,
    });

  sendJson(
    response,
    200,
    {
      membership: {
        id: membership.id,
        userId: membership.userId,
        role: membership.role,
      },
    },
    { "x-osva-request-id": requestId },
  );
}

async function handleRemoveMembership(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanMembershipHttpServices,
  requestId: string,
  workspaceId: WorkspaceId,
  membershipId: WorkspaceMembershipId,
): Promise<void> {
  const actorUserId = await requireActorUserId(
    request,
    response,
    services,
    requestId,
  );
  if (actorUserId === undefined) {
    return;
  }

  assertWorkspaceHeaderMatchesPath(request, workspaceId);

  await authorizeMembershipRoute(
    services,
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBERSHIP_DELETE,
    workspaceId,
  );

  await services.identity.removeNonOwnerWorkspaceMembership({
    workspaceId,
    membershipId,
    actorUserId,
  });

  response.statusCode = 204;
  response.setHeader("x-osva-request-id", requestId);
  response.end();
}

async function handleGrantOwner(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanMembershipHttpServices,
  requestId: string,
  workspaceId: WorkspaceId,
  membershipId: WorkspaceMembershipId,
): Promise<void> {
  const actorUserId = await requireActorUserId(
    request,
    response,
    services,
    requestId,
  );
  if (actorUserId === undefined) {
    return;
  }

  assertWorkspaceHeaderMatchesPath(request, workspaceId);

  await authorizeMembershipRoute(
    services,
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_OWNERSHIP_GRANT,
    workspaceId,
  );

  const membership = await services.identity.grantWorkspaceOwnership({
    workspaceId,
    membershipId,
    actorUserId,
  });

  sendJson(
    response,
    200,
    {
      membership: {
        id: membership.id,
        userId: membership.userId,
        role: membership.role,
      },
    },
    { "x-osva-request-id": requestId },
  );
}

async function handleTransferOwnership(
  request: IncomingMessage,
  response: ServerResponse,
  services: HumanMembershipHttpServices,
  requestId: string,
  workspaceId: WorkspaceId,
): Promise<void> {
  const actorUserId = await requireActorUserId(
    request,
    response,
    services,
    requestId,
  );
  if (actorUserId === undefined) {
    return;
  }

  assertWorkspaceHeaderMatchesPath(request, workspaceId);

  await authorizeMembershipRoute(
    services,
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_OWNERSHIP_TRANSFER,
    workspaceId,
  );

  const body = transferWorkspaceOwnershipRequestSchema.parse(
    await readJsonBody(request),
  );

  await services.identity.transferWorkspaceOwnership({
    workspaceId,
    toUserId: body.toUserId as UserId,
    actorUserId,
    ...(body.demotedRole === undefined
      ? {}
      : { demotedRole: body.demotedRole }),
  });

  sendJson(response, 200, { status: "ok" }, { "x-osva-request-id": requestId });
}

export function assertWorkspaceHeaderMatchesPath(
  request: IncomingMessage,
  workspaceId: WorkspaceId,
): void {
  const raw = request.headers[OSVA_WORKSPACE_ID_HEADER.toLowerCase()];
  if (typeof raw === "string" && raw.length > 0 && raw !== workspaceId) {
    throw new PermissionDeniedError();
  }
}
