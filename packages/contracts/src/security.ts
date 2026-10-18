import type { ApiKeyId, UserId, WorkspaceId } from "./ids.js";
import type { HumanWorkspaceRole } from "./human-identity.js";

export const AUTHENTICATION_METHODS = {
  API_KEY: "API_KEY",
  HUMAN_SESSION: "HUMAN_SESSION",
  SYSTEM: "SYSTEM",
} as const;

export type AuthenticationMethod =
  (typeof AUTHENTICATION_METHODS)[keyof typeof AUTHENTICATION_METHODS];

export const COMMUNITY_EDITION_ROLES = {
  VIEWER: "VIEWER",
  OPERATOR: "OPERATOR",
  EDITOR: "EDITOR",
  ADMIN: "ADMIN",
} as const;

export type CommunityEditionRole =
  (typeof COMMUNITY_EDITION_ROLES)[keyof typeof COMMUNITY_EDITION_ROLES];

export const AUTHORIZATION_ACTIONS = {
  READ: "READ",
  EXECUTE: "EXECUTE",
  WRITE: "WRITE",
  ADMIN: "ADMIN",
} as const;

export type AuthorizationAction =
  (typeof AUTHORIZATION_ACTIONS)[keyof typeof AUTHORIZATION_ACTIONS];

export const PUBLIC_API_ERROR_CODES = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  WORKSPACE_SELECTION_REQUIRED: "WORKSPACE_SELECTION_REQUIRED",
} as const;

export const OSVA_UNAUTHENTICATED_RATE_LIMIT_PER_MINUTE = 60;
export const OSVA_AUTHENTICATED_RATE_LIMIT_PER_MINUTE = 600;
export const OSVA_RATE_LIMIT_WINDOW_SECONDS = 60;

/** Default maximum JSON request body size for ordinary REST handlers (1 MiB). */
export const OSVA_DEFAULT_JSON_BODY_MAX_BYTES = 1_048_576;

export type PublicApiErrorCode =
  (typeof PUBLIC_API_ERROR_CODES)[keyof typeof PUBLIC_API_ERROR_CODES];

export const AUTHENTICATION_FAILURE_REASONS = {
  MALFORMED_TOKEN: "malformed_token",
  UNKNOWN_KEY: "unknown_key",
  REVOKED_KEY: "revoked_key",
  EXPIRED_KEY: "expired_key",
  INVALID_SECRET: "invalid_secret",
} as const;

export type AuthenticationFailureReason =
  (typeof AUTHENTICATION_FAILURE_REASONS)[keyof typeof AUTHENTICATION_FAILURE_REASONS];

export interface ApiKeyRequestPrincipal {
  readonly authenticationMethod: typeof AUTHENTICATION_METHODS.API_KEY;
  readonly subjectId: ApiKeyId;
  readonly workspaceId: WorkspaceId;
  readonly role: CommunityEditionRole;
}

export interface HumanSessionRequestPrincipal {
  readonly authenticationMethod: typeof AUTHENTICATION_METHODS.HUMAN_SESSION;
  readonly userId: UserId;
  readonly sessionId: string;
  readonly workspaceId?: WorkspaceId;
  readonly humanRole?: HumanWorkspaceRole;
}

export interface SystemRequestPrincipal {
  readonly authenticationMethod: typeof AUTHENTICATION_METHODS.SYSTEM;
  readonly subjectId: string;
  readonly workspaceId: WorkspaceId;
  readonly role: CommunityEditionRole;
}

export type RequestPrincipal =
  | ApiKeyRequestPrincipal
  | HumanSessionRequestPrincipal
  | SystemRequestPrincipal;

export function isApiKeyRequestPrincipal(
  principal: RequestPrincipal,
): principal is ApiKeyRequestPrincipal {
  return principal.authenticationMethod === AUTHENTICATION_METHODS.API_KEY;
}

export function isHumanSessionRequestPrincipal(
  principal: RequestPrincipal,
): principal is HumanSessionRequestPrincipal {
  return (
    principal.authenticationMethod === AUTHENTICATION_METHODS.HUMAN_SESSION
  );
}

export function isSystemRequestPrincipal(
  principal: RequestPrincipal,
): principal is SystemRequestPrincipal {
  return principal.authenticationMethod === AUTHENTICATION_METHODS.SYSTEM;
}

export function requestPrincipalRateLimitKey(
  principal: RequestPrincipal,
): string {
  if (isApiKeyRequestPrincipal(principal)) {
    return `${principal.workspaceId}:${principal.subjectId}`;
  }
  if (isHumanSessionRequestPrincipal(principal)) {
    return `human:${principal.userId}:${principal.sessionId}`;
  }
  return `system:${principal.subjectId}:${principal.workspaceId}`;
}

export interface AuthContextResourceV1 {
  readonly subjectId: ApiKeyId;
  readonly workspaceId: WorkspaceId;
  readonly role: CommunityEditionRole;
}

export const API_KEY_NAME_MAX_LENGTH = 128;

export const OSVA_REQUEST_ID_HEADER = "x-osva-request-id";

/** Selected workspace for human session authorization on control-plane routes. */
export const OSVA_WORKSPACE_ID_HEADER = "x-osva-workspace-id";
