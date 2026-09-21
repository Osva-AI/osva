import type {
  AuthorizationAction,
  CommunityEditionRole,
  RequestPrincipal,
  WorkspaceId,
} from "@osva/contracts";
import {
  AUTHORIZATION_ACTIONS,
  COMMUNITY_EDITION_ROLES,
} from "@osva/contracts";

import { PermissionDeniedError } from "./security-errors.js";

export interface AuthorizationResource {
  readonly kind: string;
}

export interface AuthorizationContext {
  readonly workspaceId: WorkspaceId;
}

const ROLE_ACTIONS: Readonly<
  Record<CommunityEditionRole, ReadonlySet<AuthorizationAction>>
> = {
  [COMMUNITY_EDITION_ROLES.VIEWER]: new Set<AuthorizationAction>([
    AUTHORIZATION_ACTIONS.READ,
  ]),
  [COMMUNITY_EDITION_ROLES.OPERATOR]: new Set<AuthorizationAction>([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
  ]),
  [COMMUNITY_EDITION_ROLES.EDITOR]: new Set<AuthorizationAction>([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
    AUTHORIZATION_ACTIONS.WRITE,
  ]),
  [COMMUNITY_EDITION_ROLES.ADMIN]: new Set<AuthorizationAction>([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
    AUTHORIZATION_ACTIONS.WRITE,
    AUTHORIZATION_ACTIONS.ADMIN,
  ]),
};

export function rolePermitsAction(
  role: CommunityEditionRole,
  action: AuthorizationAction,
): boolean {
  return ROLE_ACTIONS[role].has(action);
}

export function authorize(
  subject: RequestPrincipal,
  action: AuthorizationAction,
  _resource: AuthorizationResource,
  context: AuthorizationContext,
): void {
  if (subject.workspaceId !== context.workspaceId) {
    throw new PermissionDeniedError();
  }

  if (!rolePermitsAction(subject.role, action)) {
    throw new PermissionDeniedError();
  }
}
